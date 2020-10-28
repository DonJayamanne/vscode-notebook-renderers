/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import '@jupyter-widgets/controls/css/labvariables.css';
import type { Kernel } from '@jupyterlab/services';
import { KernelMessage } from '@jupyterlab/services';
import type { nbformat } from '@jupyterlab/services/node_modules/@jupyterlab/coreutils';
import { Widget } from '@phosphor/widgets';
import 'rxjs/add/operator/concatMap';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { createDeferred, Deferred } from './misc/async';
import { IDisposable, IIPyWidgetManager, KernelManagerForRenderer } from './types';
import { JupyterlabWidgetManager } from '../base/manager';

// eslint-disable-next-line @typescript-eslint/no-empty-function, no-empty
const noop = () => {};
export const WIDGET_MIMETYPE = 'application/vnd.jupyter.widget-view+json';

import { JUPYTER_CONTROLS_VERSION } from '@jupyter-widgets/controls/lib/version';
import * as base from '@jupyter-widgets/base';
import * as widgets from '@jupyter-widgets/controls';
import * as outputWidgets from '@jupyter-widgets/jupyterlab-manager/lib/output';
// import './widgets.css';

// Export the following for `requirejs`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty, @typescript-eslint/no-empty-function
// const define = (window as any).define || function () {};
// define('@jupyter-widgets/controls', () => widgets);
// define('@jupyter-widgets/base', () => base);
// define('@jupyter-widgets/output', () => outputWidgets);

export function createManager(b: KernelManagerForRenderer) {
    console.log('createManager');
    return new WidgetManager(b);
}
export function getInstance() {
    return WidgetManager.instance;
}
// tslint:disable: no-any

class WidgetManager implements IIPyWidgetManager {
    public static get instance(): Observable<WidgetManager | undefined> {
        return WidgetManager._instance;
    }
    private static _instance = new ReplaySubject<WidgetManager | undefined>();
    private manager?: JupyterlabWidgetManager;
    public proxyKernel?: Kernel.IKernel;
    /**
     * Contains promises related to model_ids that need to be displayed.
     * When we receive a message from the kernel of type = `display_data` for a widget (`application/vnd.jupyter.widget-view+json`),
     * then its time to display this.
     * We need to keep track of this. A boolean is sufficient, but we're using a promise so we can be notified when it is ready.
     *
     * @private
     * @memberof WidgetManager
     */
    private modelIdsToBeDisplayed = new Map<string, Deferred<void>>();
    private disposables: IDisposable[] = [];
    constructor(
        private readonly kernelManager: KernelManagerForRenderer
    ) {
        console.log('WidgetManager.ctor.start');
        // Handshake.
        kernelManager.notifications.onInitialized();
        kernelManager.onDidCreateKernel(this.initializeKernelAndWidgetManager.bind(this));
        kernelManager.onDidRestartKernel(() => {
            // Kernel was restarted.
            this.manager?.dispose(); // NOSONAR
            this.manager = undefined;
            this.proxyKernel?.dispose(); // NOSONAR
            this.proxyKernel = undefined;
            WidgetManager._instance.next(undefined);
        });
        console.log('WidgetManager.ctor.mid');
        if (kernelManager.getKernel()){
            console.log('WidgetManager.ctor.kernel exists');
            console.log('WidgetManager.ctor.kernel exists');
            console.log('WidgetManager.ctor.kernel exists');
            console.log('WidgetManager.ctor.kernel exists');
            console.log('WidgetManager.ctor.kernel exists');
            this.initializeKernelAndWidgetManager(kernelManager.getKernel());
        }
        console.log('WidgetManager.ctor.end');
    }
    public dispose(): void {
        this.proxyKernel?.dispose(); // NOSONAR
        this.disposables.forEach((d) => d.dispose());
        this.clear().then(noop, noop);
    }
    public async clear(): Promise<void> {
        await this.manager?.clear_state();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any

    /**
     * Renders a widget and returns a disposable (to remove the widget).
     *
     * @param {(nbformat.IMimeBundle & {model_id: string; version_major: number})} data
     * @param {HTMLElement} ele
     * @returns {Promise<{ dispose: Function }>}
     * @memberof WidgetManager
     */
    public async renderWidget(
        data: nbformat.IMimeBundle & { model_id: string; version_major: number },
        ele: HTMLElement
    ): Promise<Widget | undefined> {
        console.error('WidgetManager.renderWidget');
        if (!data) {
            throw new Error(
                "application/vnd.jupyter.widget-view+json not in msg.content.data, as msg.content.data is 'undefined'."
            );
        }
        if (!this.manager) {
            throw new Error('DS IPyWidgetManager not initialized.');
        }

        if (!data || data.version_major !== 2) {
            console.warn('Widget data not available to render an ipywidget');
            return undefined;
        }

        const modelId = data.model_id as string;
        // Check if we have processed the data for this model.
        // If not wait.
        if (!this.modelIdsToBeDisplayed.has(modelId)) {
            this.modelIdsToBeDisplayed.set(modelId, createDeferred());
        }
        // Wait until it is flagged as ready to be processed.
        // This widget manager must have received this message and performed all operations before this.
        // Once all messages prior to this have been processed in sequence and this message is received,
        // then, and only then are we ready to render the widget.
        // I.e. this is a way of synchronizing the render with the processing of the messages.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.modelIdsToBeDisplayed.get(modelId)!.promise;

        const modelPromise = this.manager.get_model(data.model_id);
        if (!modelPromise) {
            console.warn('Widget model not available to render an ipywidget');
            return undefined;
        }

        // ipywdigets may not have completed creating the model.
        // ipywidgets have a promise, as the model may get created by a 3rd party library.
        // That 3rd party library may not be available and may have to be downloaded.
        // Hence the promise to wait until it has been created.
        try {
            // tslint:disable: no-console
            console.log('Render Widget in manager1.ts');
            // await sleep(5_000);
            const model = await modelPromise;
            console.log('Render Widget in manager2.ts');
            const view = await this.manager.create_view(model, { el: ele });
            console.log('Render Widget in manager2.ts');
            // tslint:disable-next-line: no-any
            const widget = await this.manager.display_view(data, view, { node: ele });
            console.log('Finished Render Widget in manager2.ts');
            return widget;
        } catch (ex) {
            // tslint:disable-next-line: no-console
            console.error('Kaboom', ex);
            throw ex;
        }
    }
    private initializeKernelAndWidgetManager(kernel: Kernel.IKernel) {
        // if (this.proxyKernel && fastDeepEqual(options, this.options)) {
        //     return;
        // }
        console.log('initializeKernelAndWidgetManager1');
        this.proxyKernel?.dispose(); // NOSONAR
        this.proxyKernel = kernel;

        // Dispose any existing managers.
        this.manager?.dispose(); // NOSONAR
        try {
            // The JupyterLabWidgetManager will be exposed in the global variable `window.ipywidgets.main` (check webpack config - src/ipywidgets/webpack.config.js).
            // tslint:disable-next-line: no-any
            // Create the real manager and point it at our proxy kernel.
            console.log('initializeKernelAndWidgetManager2');
            this.manager = new JupyterlabWidgetManager(this.proxyKernel, undefined, {
                errorHandler: this.kernelManager.widgets.notifyWidgetLoadFailure,
                loadWidgetScript: this.kernelManager.widgets.loadAndRegisterWidgetWithRequire,
                successHandler: this.kernelManager.widgets.notifyWidgetLoadSuccess
            });
            // define('@jupyter-widgets/controls', () => widgets);
            // define('@jupyter-widgets/base', () => base);
            // define('@jupyter-widgets/output', () => outputWidgets);
            // const WIDGET_REGISTRY = [];
            this.manager.register({
                name: '@jupyter-widgets/base',
                version: '1.2.0',
                exports: {
                    WidgetModel: base.WidgetModel,
                    WidgetView: base.WidgetView,
                    DOMWidgetView: base.DOMWidgetView,
                    DOMWidgetModel: base.DOMWidgetModel,
                    LayoutModel: base.LayoutModel,
                    LayoutView: base.LayoutView,
                    StyleModel: base.StyleModel,
                    StyleView: base.StyleView
                }
            });
            this.manager.register({
                name: '@jupyter-widgets/controls',
                version: JUPYTER_CONTROLS_VERSION,
                exports: widgets as any
            });
            this.manager.register({
                name: '@jupyter-widgets/output',
                version: '1.0.0',
                exports: outputWidgets as any
            });

            // Listen for display data messages so we can prime the model for a display data
            this.proxyKernel.iopubMessage.connect(this.handleDisplayDataMessage.bind(this));

            // Listen for unhandled IO pub so we can forward to the extension
            this.manager.onUnhandledIOPubMessage.connect(this.handleUnhandledIOPubMessage.bind(this));

            // Tell the observable about our new manager
            WidgetManager._instance.next(this);
        } catch (ex) {
            // tslint:disable-next-line: no-console
            console.error('Failed to initialize WidgetManager', ex);
        }
    }
    /**
     * Ensure we create the model for the display data.
     */
    private handleDisplayDataMessage(_sender: any, payload: KernelMessage.IIOPubMessage) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        // const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR

        if (!KernelMessage.isDisplayDataMsg(payload)) {
            return;
        }
        const displayMsg = payload as KernelMessage.IDisplayDataMsg;

        if (displayMsg.content && displayMsg.content.data && displayMsg.content.data[WIDGET_MIMETYPE]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = displayMsg.content.data[WIDGET_MIMETYPE] as any;
            const modelId = data.model_id;
            let deferred = this.modelIdsToBeDisplayed.get(modelId);
            if (!deferred) {
                deferred = createDeferred();
                this.modelIdsToBeDisplayed.set(modelId, deferred);
            }
            if (!this.manager) {
                throw new Error('DS IPyWidgetManager not initialized');
            }
            const modelPromise = this.manager.get_model(data.model_id);
            if (modelPromise) {
                modelPromise.then((_m) => deferred?.resolve()).catch((e) => deferred?.reject(e));
            } else {
                deferred.resolve();
            }
        }
    }

    private handleUnhandledIOPubMessage(_manager: unknown, msg: KernelMessage.IIOPubMessage) {
        // Send this to the other side
        this.kernelManager.notifications.onUnhandledIOPubMessageReceived(msg);
    }
}
