// // Copyright (c) Microsoft Corporation. All rights reserved.
// // Licensed under the MIT License.

// 'use strict';

// // eslint-disable-next-line @typescript-eslint/no-explicit-any
// async function requirePromise(pkg: string | string[]): Promise<any> {
//     return new Promise((resolve, reject) => {
//         // eslint-disable-next-line @typescript-eslint/no-explicit-any
//         const requirejs = (window as any).requirejs;
//         if (requirejs === undefined) {
//             reject('Requirejs is needed, please ensure it is loaded on the page.');
//         } else {
//             requirejs(pkg, resolve, reject);
//         }
//     });
// }
// export function requireLoader(moduleName: string) {
//     return requirePromise([`${moduleName}`]);
// }
