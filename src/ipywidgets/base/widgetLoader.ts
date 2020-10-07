// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// const cache:any = {};
// tslint:disable-next-line: no-any
async function requirePromise(pkg: string | string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        // tslint:disable-next-line: no-any
        const requirejs = (window as any).requirejs;
        if (requirejs === undefined) {
            reject('Requirejs is needed, please ensure it is loaded on the page.');
        } else {
            // console.error(`load ${pkg[0]}`);
            // requirejs(pkg, resolve, reject);

            // if (cache[pkg[0]] && pkg[0] === 'k3d'){
            //     // console.error('k3d found');
            //     return resolve.apply({}, cache[pkg[0]] as any);
            // }
            requirejs(
                pkg,
                function () {
                    // if (pkg[0] === 'k3d'){
                    //     cache[pkg[0]] = arguments;
                    // }
                    resolve.apply({}, arguments);
                },
                reject
            );
        }
    });
}
export function requireLoader(moduleName: string) {
    return requirePromise([`${moduleName}`]);
}
