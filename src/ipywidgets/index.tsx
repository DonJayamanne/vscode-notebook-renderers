// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// This must be on top, do not change. Required by webpack.
declare let __webpack_public_path__: string;
const getPublicPath = () => {
    const currentDirname = (document.currentScript as HTMLScriptElement).src.replace(/[^/]+$/, '');
    return new URL(currentDirname).toString();
};

// eslint-disable-next-line prefer-const
__webpack_public_path__ = getPublicPath();
// This must be on top, do not change. Required by webpack.

export { JupyterlabWidgetManager as WidgetManager } from './base/manager';
import * as base from '@jupyter-widgets/base';
import * as widgets from '@jupyter-widgets/controls';
import * as outputWidgets from '@jupyter-widgets/jupyterlab-manager/lib/output';
import { initialize } from './integration';
import './widgets.css';

// Export the following for `requirejs`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any, no-empty, @typescript-eslint/no-empty-function
const define = (window as any).define || function () {};
define('@jupyter-widgets/controls', () => widgets);
define('@jupyter-widgets/base', () => base);
define('@jupyter-widgets/output', () => outputWidgets);

////////////////////////// not change. Required by webpack.
const JupyterIPyWidgetNotebookRenderer = 'jupyter-ipywidget-renderer';
initialize(acquireNotebookRendererApi(JupyterIPyWidgetNotebookRenderer));
