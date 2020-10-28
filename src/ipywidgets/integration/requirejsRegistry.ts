// // Copyright (c) Microsoft Corporation. All rights reserved.
// // Licensed under the MIT License.

// 'use strict';

// import { WidgetScriptSource } from './types';

// type NonPartial<T> = {
//     [P in keyof T]-?: T[P];
// };

// // Key = module name, value = path to script.
// const scriptsAlreadyRegisteredInRequireJs = new Map<string, string>();

// function getScriptsToBeRegistered(scripts: WidgetScriptSource[]) {
//     return scripts.filter((script) => {
//         // Ignore scripts that have already been registered once before.
//         if (
//             scriptsAlreadyRegisteredInRequireJs.has(script.moduleName) &&
//             scriptsAlreadyRegisteredInRequireJs.get(script.moduleName) === script.scriptUri
//         ) {
//             return false;
//         }
//         return true;
//     });
// }

// function getScriptsWithAValidScriptUriToBeRegistered(scripts: WidgetScriptSource[]) {
//     return scripts
//         .filter((source) => {
//             if (source.scriptUri) {
//                 console.log(
//                     `Source for IPyWidget ${source.moduleName} found in ${source.source} @ ${source.scriptUri}.`
//                 );
//                 return true;
//             } else {
//                 console.error(`Source for IPyWidget ${source.moduleName} not found.`);
//                 return false;
//             }
//         })
//         .map((source) => source as NonPartial<WidgetScriptSource>);
// }

// function registerScriptsInRequireJs(scripts: NonPartial<WidgetScriptSource>[]) {
//     // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
//     const requirejs = (window as any).require as { config: Function };
//     if (!requirejs) {
//         window.console.error('Requirejs not found');
//         throw new Error('Requirejs not found');
//     }
//     const config: { paths: Record<string, string> } = {
//         paths: {}
//     };
//     scripts.forEach((script) => {
//         console.warn('Script registered', script.scriptUri);
//         scriptsAlreadyRegisteredInRequireJs.set(script.moduleName, script.scriptUri);
//         // Drop the `.js` from the scriptUri.
//         const scriptUri = script.scriptUri.toLowerCase().endsWith('.js')
//             ? script.scriptUri.substring(0, script.scriptUri.length - 3)
//             : script.scriptUri;
//         // Register the script source into requirejs so it gets loaded via requirejs.
//         config.paths[script.moduleName] = scriptUri;
//     });
//     requirejs.config(config);
// }

// export function registerScripts(scripts: WidgetScriptSource[]) {
//     const scriptsToRegister = getScriptsToBeRegistered(scripts);
//     const validScriptsToRegister = getScriptsWithAValidScriptUriToBeRegistered(scriptsToRegister);
//     registerScriptsInRequireJs(validScriptsToRegister);
// }
