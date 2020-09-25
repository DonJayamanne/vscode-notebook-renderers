// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { nbformat } from '@jupyterlab/coreutils';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createDeferred, Deferred } from './misc/async';
import { WidgetManagerComponent } from './container';
import { createEmitter } from './events';
import { WidgetManager } from './manager';
import { IPyWidgetMessages, WidgetScriptSource, Event, IPyWidgetsPostOffice, IPyWidgetsSettings } from './types';
import type { NotebookOutputEventParams, NotebookRendererApi } from 'vscode-notebook-renderer';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};
// tslint:disable-next-line: no-any
export function initialize(api: NotebookRendererApi<any>) {
    // Possible this (pre-render script loaded after notebook attempted to render something).
    // At this point we need to go and render the existing output.
    initWidgets(api);
    // renderOnLoad();
}

const outputDisposables = new Map<string, { dispose(): void }>();
const outputDisposables2 = new WeakMap<HTMLElement, { dispose(): void }>();
// window.addEventListener('message', (e) => {
//     // tslint:disable-next-line: no-console
//     // console.error(`Message from backend`, e.data);
//     if (e.data && e.data.type === 'fromKernel') {
//         postToKernel('HelloKernel', 'WorldKernel');
//     }
// });
const renderedWidgets = new Set<string>();
/**
 * Called from renderer to render output.
 * This will be exposed as a public method on window for renderer to render output.
 */
function renderOutput(request: NotebookOutputEventParams) {
    try {
        console.error('request', request);
        const output = convertVSCodeOutputToExecutResultOrDisplayData(request);
        console.log(`Rendering mimeType ${request.mimeType}`, output);
        console.error('request output', output);

        // tslint:disable-next-line: no-any
        const model = output['application/vnd.jupyter.widget-view+json'] as any;
        if (!model) {
            // tslint:disable-next-line: no-console
            return console.error('Nothing to render');
        }
        // tslint:disable: no-console
        renderIPyWidget(request.outputId, model, request.element);
    } catch (ex) {
        console.error(`Failed to render ipywidget type`, ex);
    }

    // postToRendererExtension('Hello', 'World');
    // postToKernel('HelloKernel', 'WorldKernel');
}
export function renderIPyWidget(
    outputId: string,
    model: nbformat.IMimeBundle & { model_id: string; version_major: number },
    container: HTMLElement
) {
    // tslint:disable: no-console
    console.error('Got Something to render');
    if (renderedWidgets.has(model.model_id)) {
        return console.error('already rendering');
    }
    renderedWidgets.add(model.model_id);
    createWidgetView(model, container)
        .then((w) => {
            const disposable = {
                dispose: () => {
                    renderedWidgets.delete(model.model_id);
                    w?.dispose();
                }
            };
            outputDisposables.set(outputId, disposable);
            outputDisposables2.set(container, disposable);
        })
        .catch((ex) => console.error('Failed to render', ex));
}
export function destroyIPyWidget(ele: HTMLElement) {
    if (!outputDisposables2.has(ele)) {
        return;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    outputDisposables2.get(ele)!.dispose();
    outputDisposables2.delete(ele);
}
// /**
//  * Possible the pre-render scripts load late, after we have attempted to render output from notebook.
//  * At this point look through all such scripts and render the output.
//  */
// function renderOnLoad() {
//     document
//         .querySelectorAll<HTMLScriptElement>('script[type="application/vscode-jupyter-ipywidget+json"]')
//         .forEach(renderOutput);
// }

// tslint:disable-next-line: no-any
// function postToRendererExtension(type: string, payload: any) {
//     notebookApi.postMessage({ type, payload });
// }
// tslint:disable-next-line: no-any

class MyPostOffice implements IPyWidgetsPostOffice {
    public get settings(): IPyWidgetsSettings | undefined {
        return { timeoutWaitingForWidgetsToLoad: 5_000 };
    }
    // tslint:disable-next-line: no-any
    public get onDidReceiveKernelMessage(): Event<any> {
        return this._gotMessage.event;
    }
    private readonly _gotMessage = createEmitter();
    private readonly backendReady = createDeferred();
    private readonly scripts = new Map<string, Deferred<WidgetScriptSource>>();
    constructor(private readonly api: NotebookRendererApi<any>) {
        try {
            // For testing, we might use a  browser to load  the stuff.
            // In such instances the `acquireVSCodeApi` will return the event handler to get messages from extension.
            // See ./src/datascience-ui/native-editor/index.html
            // tslint:disable-next-line: no-any
            // const api = (vscApi as any) as { handleMessage?: Function };
            api.onDidReceiveMessage(this.onMessage.bind(this));
        } catch {
            // Ignore.
            console.error('Oops in ctor of MyPostOffice');
        }

        // window.addEventListener('message', this.onMessage.bind(this));
        // postToKernel('__IPYWIDGET_KERNEL_MESSAGE', { message: IPyWidgetMessages.IPyWidgets_Ready });
    }
    private postToKernel(type: string, payload?: any) {
        this.api.postMessage({ type, payload });
    }

    private onMessage(e: MessageEvent) {
        // tslint:disable
        const type: string | undefined = e.data.type ?? e.data.message;
        if (e.data && type) {
            // tslint:disable-next-line: no-console
            // console.error('processing messages', e.data);
            // tslint:disable-next-line: no-console
            const payload = e.data.payload;
            if (type === IPyWidgetMessages.IPyWidgets_WidgetScriptSourceResponse) {
                // console.error('Got Script source', payload);
                const source: WidgetScriptSource | undefined = payload;
                if (source && this.scripts.has(source.moduleName)) {
                    // console.error('Got Script source and module', payload);
                    this.scripts.get(source.moduleName)?.resolve(source); // NOSONAR
                } else {
                    console.error('Got Script source and module not found', source?.moduleName);
                }
                return;
            } else if (type && type.toUpperCase().startsWith('IPYWIDGET')) {
                // tslint:disable-next-line: no-console
                // console.error(`Message from real backend kernel`, payload);
                this._gotMessage.fire({ type, message: type, payload });
            } else if (type === '__IPYWIDGET_BACKEND_READY') {
                this.backendReady.resolve();
                // } else {
                //     console.error(`No idea what this data is`, e.data);
            }
        }
    }
    // tslint:disable-next-line: no-any
    public postKernelMessage(message: any, payload: any): void {
        this.backendReady.promise.then(() => this.postToKernel(message, payload)).catch(noop);
    }
    public async getWidgetScriptSource(options: {
        moduleName: string;
        moduleVersion: string;
    }): Promise<WidgetScriptSource> {
        const deferred = createDeferred<WidgetScriptSource>();
        this.scripts.set(options.moduleName, deferred);
        // Whether we have the scripts or not, send message to extension.
        // Useful telemetry and also we know it was explicity requested by ipywidgets.
        this.postKernelMessage(IPyWidgetMessages.IPyWidgets_WidgetScriptSourceRequest, options);

        return deferred.promise;
    }
    public onReady(): void {
        this.postToKernel(IPyWidgetMessages.IPyWidgets_Ready);
        this.postToKernel('READY');
    }
}

let widgetManagerPromise: Promise<WidgetManager> | undefined;
async function getWidgetManager(): Promise<WidgetManager> {
    if (!widgetManagerPromise) {
        widgetManagerPromise = new Promise((resolve) => WidgetManager.instance.subscribe(resolve));
        widgetManagerPromise
            .then((wm) => {
                if (wm) {
                    const oldDispose = wm.dispose.bind(wm);
                    wm.dispose = () => {
                        // this.renderedViews.clear();
                        // this.widgetManager = undefined;
                        widgetManagerPromise = undefined;
                        return oldDispose();
                    };
                }
            })
            .catch(noop);
    }
    return widgetManagerPromise;
}

async function createWidgetView(
    widgetData: nbformat.IMimeBundle & { model_id: string; version_major: number },
    element: HTMLElement
) {
    const wm = await getWidgetManager();
    try {
        return await wm?.renderWidget(widgetData, element);
    } catch (ex) {
        // tslint:disable-next-line: no-console
        console.error('Failed to render widget', ex);
    }
}

function initWidgets(api: NotebookRendererApi<any>) {
    api.onDidCreateOutput(renderOutput);

    api.onWillDestroyOutput((e) => {
        if (e?.outputId && outputDisposables.has(e.outputId)) {
            outputDisposables.get(e.outputId)?.dispose(); // NOSONAR
            outputDisposables.delete(e.outputId);
        }
    });
    api.postMessage('Loaded');
    api.onDidReceiveMessage((msg) => {
        // tslint:disable-next-line: no-console
        console.error(`Message from renderer`, msg);
    });

    // tslint:disable-next-line: no-console
    console.error('Rendering widget container');
    try {
        const postOffice: IPyWidgetsPostOffice = new MyPostOffice(api);
        const container = document.createElement('div');
        document.body.appendChild(container);
        ReactDOM.render(
            React.createElement(WidgetManagerComponent, { postOffice, widgetContainerElement: container }, null),
            container
        );
    } catch (ex) {
        // tslint:disable-next-line: no-console
        console.error('Ooops', ex);
    }
}

function convertVSCodeOutputToExecutResultOrDisplayData(
    request: NotebookOutputEventParams
): nbformat.IExecuteResult | nbformat.IDisplayData {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: Record<string, any> = {};
    // Send metadata only for the mimeType we are interested in.
    const customMetadata = request.output.metadata?.custom;
    if (customMetadata) {
        if (customMetadata[request.mimeType]) {
            metadata[request.mimeType] = customMetadata[request.mimeType];
        }
        if (customMetadata.needs_background) {
            metadata.needs_background = customMetadata.needs_background;
        }
        if (customMetadata.unconfined) {
            metadata.unconfined = customMetadata.unconfined;
        }
    }

    return {
        data: {
            [request.mimeType]: request.output.data[request.mimeType]
        },
        metadata,
        execution_count: null,
        output_type: request.output.metadata?.custom?.vscode?.outputType || 'execute_result'
    };
}
