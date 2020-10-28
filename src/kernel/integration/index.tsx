// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
console.log('1 of Kernel');

// export { JupyterlabWidgetManager as WidgetManager } from './base/manager';
// import * as base from '@jupyter-widgets/base';
// import * as widgets from '@jupyter-widgets/controls';
// import * as outputWidgets from '@jupyter-widgets/jupyterlab-manager/lib/output';
// import './widgets.css';

// // // Export the following for `requirejs`.
// // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty, @typescript-eslint/no-empty-function
// const define = (window as any).define || function () {};
// define('@jupyter-widgets/controls', () => widgets);
// define('@jupyter-widgets/base', () => base);
// define('@jupyter-widgets/output', () => outputWidgets);
import fastDeepEqual from 'fast-deep-equal';
import * as isonline from 'is-online';
import { createDeferred, Deferred } from './misc/async';
import { create as createKernel } from './kernel';
import { createEmitter } from './events';
import {
    IPyWidgetMessages,
    WidgetScriptSource,
    Event,
    IPyWidgetsPostOffice,
    IPyWidgetsSettings,
    SharedMessages,
    KernelSocketOptions,
    IIPyWidgetManager,
    Settings,
    KernelManagerForRenderer
} from './types';
import { registerScripts } from './requirejsRegistry';
import { warnAboutWidgetVersionsThatAreNotSupported } from './incompatibleWidgetHandler';
import type { Kernel } from '@jupyterlab/services';
import { createManager, getInstance } from './manager';
console.log('2 of Kernel');

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

class MyPostOffice implements IPyWidgetsPostOffice {
    public get settings(): IPyWidgetsSettings | undefined {
        return { timeoutWaitingForWidgetsToLoad: 5_000 };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get onDidReceiveKernelMessage(): Event<any> {
        return this._gotMessage.event;
    }
    private readonly _gotMessage = createEmitter();
    private readonly backendReady = createDeferred();
    private readonly scripts = new Map<string, Deferred<WidgetScriptSource>>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private readonly api: { postMessage(msg: any): void }) {
        try {
            // For testing, we might use a  browser to load  the stuff.
            // In such instances the `acquireVSCodeApi` will return the event handler to get messages from extension.
            // See ./src/datascience-ui/native-editor/index.html
            window.addEventListener('message', this.onMessage.bind(this));
            // api.onDidReceiveMessage(this.onMessage.bind(this));
        } catch (ex) {
            // Ignore.
            console.error('Oops in ctor of MyPostOffice', ex);
        }
    }
    private postToKernel(type: string, payload?: any) {
        // window.postMessage({ type, payload })
        this.api.postMessage({ type, payload });
    }

    private onMessage(e: MessageEvent) {
        // console.error(`Got Message in PostOffice`);
        // tslint:disable
        const type: string | undefined = e.data.type ?? e.data.message;
        // console.error(`Got Message in PostOffice type = ${type}`);
        // console.error(`Got Message in PostOffice payload = ${e.data.payload}`);
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
        console.error(`Message sent ${message}`);
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

console.log('3 of Kernel');

export class ScriptLoader {
    private readonly widgetSourceRequests = new Map<
        string,
        { deferred: Deferred<void>; timer?: NodeJS.Timeout | number }
    >();
    private readonly registeredWidgetSources = new Map<string, WidgetScriptSource>();
    private timedOutWaitingForWidgetsToGetLoaded?: boolean;
    private widgetsCanLoadFromCDN = true; // Temporary.
    private readonly loaderSettings = {
        // Total time to wait for a script to load. This includes ipywidgets making a request to extension for a Uri of a widget,
        // then extension replying back with the Uri (max 5 seconds round trip time).
        // If expires, then Widget downloader will attempt to download with what ever information it has (potentially failing).
        // Note, we might have a message displayed at the user end (asking for consent to use CDN).
        // Hence use 60 seconds.
        timeoutWaitingForScriptToLoad: 60_000,
        // List of widgets that must always be loaded using requirejs instead of using a CDN or the like.
        widgetsRegisteredInRequireJs: new Set<string>(),
        // Callback when loading a widget fails.
        errorHandler: this.handleLoadError.bind(this),
        // Callback when requesting a module be registered with requirejs (if possible).
        loadWidgetScript: this.loadWidgetScript.bind(this),
        successHandler: this.handleLoadSuccess.bind(this)
    };
    constructor(private readonly postOffice: IPyWidgetsPostOffice) {}
    public clear() {
        // This happens when we have restarted a kernel.
        // If user changed the kernel, then some widgets might exist now and some might now.
        this.widgetSourceRequests.clear();
        this.registeredWidgetSources.clear();
    }
    public async handleLoadError(
        className: string,
        moduleName: string,
        moduleVersion: string,
        // tslint:disable-next-line: no-any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        error: any,
        timedout = false
    ) {
        if (!this.postOffice.onWidgetLoadFailure) {
            return;
        }
        const isOnline = await isonline.default({ timeout: 1000 });
        this.postOffice.onWidgetLoadFailure({
            className,
            moduleName,
            moduleVersion,
            isOnline,
            timedout,
            error,
            cdnsUsed: this.widgetsCanLoadFromCDN
        });
    }
    /**
     * Given a list of the widgets along with the sources, we will need to register them with requirejs.
     * IPyWidgets uses requirejs to dynamically load modules.
     * (https://requirejs.org/docs/api.html)
     * All we're doing here is given a widget (module) name, we register the path where the widget (module) can be loaded from.
     * E.g.
     * requirejs.config({ paths:{
     *  'widget_xyz': '<Url of script without trailing .js>'
     * }});
     */
    private registerScriptSourcesInRequirejs(sources: WidgetScriptSource[]) {
        if (!Array.isArray(sources) || sources.length === 0) {
            return;
        }

        registerScripts(sources);

        // Now resolve promises (anything that was waiting for modules to get registered can carry on).
        sources.forEach((source) => {
            this.registeredWidgetSources.set(source.moduleName, source);
            // We have fetched the script sources for all of these modules.
            // In some cases we might not have the source, meaning we don't have it or couldn't find it.
            let request = this.widgetSourceRequests.get(source.moduleName);
            if (!request) {
                request = {
                    deferred: createDeferred(),
                    timer: undefined
                };
                this.widgetSourceRequests.set(source.moduleName, request);
            }
            request.deferred.resolve();
            if (request.timer !== undefined) {
                // tslint:disable-next-line: no-any
                clearTimeout(request.timer as any); // This is to make this work on Node and Browser
            }
        });
    }
    private registerScriptSourceInRequirejs(source?: WidgetScriptSource) {
        if (!source) {
            return;
        }
        this.registerScriptSourcesInRequirejs([source]);
    }

    /**
     * Method called by ipywidgets to get the source for a widget.
     * When we get a source for the widget, we register it in requriejs.
     * We need to check if it is available on CDN, if not then fallback to local FS.
     * Or check local FS then fall back to CDN (depending on the order defined by the user).
     */
    public loadWidgetScript(moduleName: string, moduleVersion: string): Promise<void> {
        // tslint:disable-next-line: no-console
        console.log(`Fetch IPyWidget source for ${moduleName}`);
        let request = this.widgetSourceRequests.get(moduleName);
        if (request) {
            console.error(`Re-use loading module ${moduleName}`);
        } else {
            console.error(`Start loading module ${moduleName}`);
            request = {
                deferred: createDeferred<void>(),
                timer: undefined
            };

            // If we timeout, then resolve this promise.
            // We don't want the calling code to unnecessary wait for too long.
            // Else UI will not get rendered due to blocking ipywidets (at the end of the day ipywidgets gets loaded via kernel)
            // And kernel blocks the UI from getting processed.
            // Also, if we timeout once, then for subsequent attempts, wait for just 1 second.
            // Possible user has ignored some UI prompt and things are now in a state of limbo.
            // This way things will fall over sooner due to missing widget sources.
            const timeoutTime = this.timedOutWaitingForWidgetsToGetLoaded
                ? 5_000
                : this.loaderSettings.timeoutWaitingForScriptToLoad;

            request.timer = setTimeout(() => {
                if (request && !request.deferred.resolved) {
                    // tslint:disable-next-line: no-console
                    console.error(`Timeout waiting to get widget source for ${moduleName}, ${moduleVersion}`);
                    this.handleLoadError(
                        '<class>',
                        moduleName,
                        moduleVersion,
                        new Error(`Timeout getting source for ${moduleName}:${moduleVersion}`),
                        true
                        // tslint:disable-next-line: no-console
                    ).catch((ex) => console.error('Failed to load in container.tsx', ex));
                    request.deferred.resolve();
                    this.timedOutWaitingForWidgetsToGetLoaded = true;
                }
            }, timeoutTime);

            this.widgetSourceRequests.set(moduleName, request);

            // Whether we have the scripts or not, send message to extension.
            // Useful telemetry and also we know it was explicity requested by ipywidgets.
            this.postOffice
                .getWidgetScriptSource({
                    moduleName,
                    moduleVersion
                })
                .then((result) => this.registerScriptSourceInRequirejs(result))
                // tslint:disable-next-line: no-console
                .catch((ex) => console.error(`Failed to fetch scripts for ${moduleName}, ${moduleVersion}`, ex));
        }

        return (
            request.deferred.promise
                .then(() => {
                    // tslint:disable-next-line: no-console
                    console.error(`Attempting to load module ${moduleName}`);
                    const widgetSource = this.registeredWidgetSources.get(moduleName);
                    if (widgetSource) {
                        warnAboutWidgetVersionsThatAreNotSupported(
                            widgetSource,
                            moduleVersion,
                            this.widgetsCanLoadFromCDN,
                            (info) => {
                                if (this.postOffice.onWidgetVersionNotSupported) {
                                    this.postOffice.onWidgetVersionNotSupported({
                                        moduleName: info.moduleName,
                                        moduleVersion: info.moduleVersion
                                    });
                                }
                            }
                        );
                    }
                })
                // tslint:disable-next-line: no-any
                .catch((ex: any) =>
                    // tslint:disable-next-line: no-console
                    console.error(
                        `Failed to load Widget Script from Extension for for ${moduleName}, ${moduleVersion}`,
                        ex
                    )
                )
        );
    }
    public handleLoadSuccess(className: string, moduleName: string, moduleVersion: string) {
        if (!this.postOffice.onWidgetLoadSuccess) {
            return;
        }
        this.postOffice.onWidgetLoadSuccess({
            className,
            moduleName,
            moduleVersion
        });
    }
}

console.log('4 of Kernel');
export declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscodeApi = acquireVsCodeApi();
const postOffice: IPyWidgetsPostOffice = new MyPostOffice(vscodeApi);
const scriptLoader = new ScriptLoader(postOffice);
let kernel: Kernel.IKernel;
let kernelOptions: KernelSocketOptions;
let pendingMessages: any[] = [];
console.log('5 of Kernel');
postOffice.onDidReceiveKernelMessage((msg) => {
    // tslint:disable-next-line: no-any
    const { type, payload } = msg;
    console.error(`Message receieved in Kernel JS ${type}`);
    if (type === SharedMessages.UpdateSettings) {
        // tslint:disable-next-line: no-console
        // console.error('Got Message 1');
        // const settings = JSON.parse(payload);
        // this.widgetsCanLoadFromCDN = settings.widgetScriptSources.length > 0;
        onDidSettingsChange.fire({
            timeoutWaitingForScriptToLoad: 60_000,
            widgetsCanLoadFromCDN: true
        });
    } else if (
        type === IPyWidgetMessages.IPyWidgets_kernelOptions
        // type === IPyWidgetMessages.IPyWidgets_onKernelChanged
    ) {
        scriptLoader.clear();
        if (kernel && fastDeepEqual(payload, kernelOptions)) {
            return;
        }
        if (kernel) {
            kernel.dispose();
        }
        // Notify changes after we have handle this.
        kernel = createKernel(payload, postOffice, pendingMessages);
        pendingMessages = [];
        onDidCreateKernel.fire(kernel);
    } else if (type === IPyWidgetMessages.IPyWidgets_onRestartKernel) {
        if (kernel) {
            kernel.dispose();
        }
        onDidRestartKernel.fire();
    } else if (
        type === IPyWidgetMessages.IPyWidgets_kernelOptions ||
        type === IPyWidgetMessages.IPyWidgets_onKernelChanged
    ) {
        scriptLoader.clear();
    } else if (!kernel) {
        pendingMessages.push({ message: type, payload });
    }
});
const onDidCreateKernel = createEmitter<Kernel.IKernel>();
const onDidRestartKernel = createEmitter<void>();
const onDidSettingsChange = createEmitter<Settings>();

const mgr: KernelManagerForRenderer = {
    onDidCreateKernel: onDidCreateKernel.event,
    onDidRestartKernel: onDidRestartKernel.event,
    onDidSettingsChange: onDidSettingsChange.event,
    getKernel() { return kernel; },
    getWidgetManager,
    widgets: {
        async loadAndRegisterWidgetWithRequire(
            moduleName: string,
            moduleVersion: string
        ): Promise<void> {
            console.log(moduleVersion);
            console.log(moduleName);
            await scriptLoader.loadWidgetScript(moduleName, moduleVersion);
        },
        notifyWidgetLoadFailure(
            className: string,
            moduleName: string,
            moduleVersion: string,
            error: Error,
            timedOut?: boolean
        ) {
            console.log(className);
            console.log(moduleVersion);
            console.log(moduleName);
            console.log(error);
            scriptLoader.handleLoadError(className, moduleName, moduleVersion, error, timedOut);
        },
        notifyWidgetLoadSuccess(className: string, moduleName: string, moduleVersion: string) {
            console.log(className);
            console.log(moduleVersion);
            console.log(moduleName);
            scriptLoader.handleLoadSuccess(className, moduleName, moduleVersion);
        }
    },
    notifications: {
        onInitialized() {
            vscodeApi.postMessage({ type: IPyWidgetMessages.IPyWidgets_Ready });
            vscodeApi.postMessage({ type: 'READY' });
            vscodeApi.postMessage({ type: 'Loaded' });
        },
        onUnhandledIOPubMessageReceived(msg) {
            vscodeApi.postMessage({
                type: IPyWidgetMessages.IPyWidgets_UnhandledKernelMessage,
                payload: msg
            });
        }
    }
};


//////////////////////////////////////
//////////////////////////////////////
//////////////////////////////////////
console.log('Create default instance');
createManager(mgr);
console.log('Create default instance2');
let widgetManagerPromise: Promise<IIPyWidgetManager> | undefined;
async function getWidgetManager(): Promise<IIPyWidgetManager> {
    console.log('getWidgetManager.1');
    if (!widgetManagerPromise) {
        widgetManagerPromise = new Promise((resolve) => getInstance().subscribe(resolve));
        widgetManagerPromise
        .then((wm) => {
            if (wm) {
                console.log('getWidgetManager.2');
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
console.log('getWidgetManager.3');







//////////////////////////////////////
//////////////////////////////////////
//////////////////////////////////////


console.log('6 of Kernel');
(window as any).kernelManagerForRenderer = mgr;
console.log('7 of Kernel');
