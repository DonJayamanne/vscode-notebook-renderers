// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// This must be on top, do not change. Required by webpack.
// declare let __webpack_public_path__: string;
// const getPublicPath = () => {
//     const currentDirname = (document.currentScript as HTMLScriptElement).src.replace(/[^/]+$/, '');
//     return new URL(currentDirname).toString();
// };

// // eslint-disable-next-line prefer-const
// __webpack_public_path__ = getPublicPath();
// This must be on top, do not change. Required by webpack.

// export { JupyterlabWidgetManager as WidgetManager } from './base/manager';
import * as base from '@jupyter-widgets/base';
import * as widgets from '@jupyter-widgets/controls';
import * as outputWidgets from '@jupyter-widgets/jupyterlab-manager/lib/output';
import './widgets.css';

// // Export the following for `requirejs`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty, @typescript-eslint/no-empty-function
const define = (window as any).define || function () {};
define('@jupyter-widgets/controls', () => widgets);
define('@jupyter-widgets/base', () => base);
define('@jupyter-widgets/output', () => outputWidgets);

////////////////////////// not change. Required by webpack.
const JupyterIPyWidgetNotebookRenderer = 'jupyter-ipywidget-renderer';
// initialize(acquireNotebookRendererApi(JupyterIPyWidgetNotebookRenderer));

// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

('use strict');

import type { nbformat } from '@jupyterlab/coreutils';
// import * as React from 'react';
// import * as ReactDOM from 'react-dom';
// import { WidgetManagerComponent } from './container';
import type { NotebookOutputEventParams, NotebookRendererApi } from 'vscode-notebook-renderer';

// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

('use strict');

// import '../../client/common/extensions';
// import { warnAboutWidgetVersionsThatAreNotSupported } from './incompatibleWidgetHandler';
import { KernelManagerForRenderer } from './kernel';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kernelManger: KernelManagerForRenderer = (globalThis as any).kernelManagerForRenderer;

// tslint:disable-next-line: no-any
function initialize(api: NotebookRendererApi<any>) {
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
        // console.error('request', request);
        const output = convertVSCodeOutputToExecutResultOrDisplayData(request);
        // console.log(`Rendering mimeType ${request.mimeType}`, output);
        // console.error('request output', output);

        // tslint:disable-next-line: no-any
        const model = output.data['application/vnd.jupyter.widget-view+json'] as any;
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
function renderIPyWidget(
    outputId: string,
    model: nbformat.IMimeBundle & { model_id: string; version_major: number },
    container: HTMLElement
) {
    // tslint:disable: no-console
    // console.error('Got Something to render');
    if (renderedWidgets.has(model.model_id)) {
        return console.error('already rendering');
    }
    const output = document.createElement('div');
    output.className = 'cell-output cell-output';
    const ele = document.createElement('div');
    ele.className = 'cell-output-ipywidget-background';
    container.appendChild(ele);
    ele.appendChild(output);
    renderedWidgets.add(model.model_id);
    createWidgetView(model, ele)
        .then((w) => {
            const disposable = {
                dispose: () => {
                    renderedWidgets.delete(model.model_id);
                    w?.dispose();
                }
            };
            outputDisposables.set(outputId, disposable);
            outputDisposables2.set(ele, disposable);
        })
        .catch((ex) => console.error('Failed to render', ex));
}

async function createWidgetView(
    widgetData: nbformat.IMimeBundle & { model_id: string; version_major: number },
    element: HTMLElement
) {
    const wm = await kernelManger.getWidgetManager();
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
    // api.onDidReceiveMessage((msg) => {
    //     // tslint:disable-next-line: no-console
    //     console.error(`Message from renderer`, msg);
    // });

    // tslint:disable-next-line: no-console
    // console.error('Rendering widget container');
    // try {
    //     const mgr = new WidgetManagerComponent();
    //     (window as any)._mgr = mgr;
    // } catch (ex) {
    //     // tslint:disable-next-line: no-console
    //     console.error('Ooops', ex);
    // }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any)._mgr = undefined;
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

initialize(acquireNotebookRendererApi(JupyterIPyWidgetNotebookRenderer));
