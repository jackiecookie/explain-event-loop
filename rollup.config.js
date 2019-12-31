import resolve from 'rollup-plugin-node-resolve';
// import commonjs from 'rollup-plugin-commonjs';
// import json from 'rollup-plugin-json';
// import replace from 'rollup-plugin-replace'  

const env = {
    DEBUG: false,
    emitWarning: undefined
}

export default {
    input: 'index.js',
    output: {
        file: 'bundle.js',
        format: 'umd'
    },
    plugins: [
        resolve(),
        // commonjs()
    ]
};