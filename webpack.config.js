const path = require('path');
const webpack = require('webpack');


module.exports = {
    mode: 'production',
    entry: './src/index.js',
    output: {
        library: "AnySocket",
        path: path.resolve(__dirname, 'dist'),
        filename: 'anysocket.browser.js'
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                loader: 'babel-loader',
                options: {
                    presets: [
                        {
                            'plugins': [
                                '@babel/plugin-proposal-class-properties'
                            ]
                        }
                    ]
                }
            }
        ]
    },
    plugins: [
        new webpack.NormalModuleReplacementPlugin(/^debug$/, function(resource) {
            resource.request = path.resolve(__dirname, 'src/browser/', "debug.js")
        }),
        new webpack.NormalModuleReplacementPlugin(/^crypto$/, function(resource) {
            resource.request = path.resolve(__dirname, 'src/browser/', "crypto.js")
        }),
        new webpack.NormalModuleReplacementPlugin(/^ws$/, function(resource) {
            resource.request = path.resolve(__dirname, 'src/browser/', "ws.js")
        }),
        new webpack.NormalModuleReplacementPlugin(/^events$/, function(resource) {
            resource.request = path.resolve(__dirname, 'src/browser/', "events.js")
        }),
        new webpack.NormalModuleReplacementPlugin(/.+utils_buffer$/, function(resource) {
            resource.request = path.resolve(__dirname, 'src/browser/', "utils_buffer.js")
        }),
        new webpack.NormalModuleReplacementPlugin(/.+transports\/http\/.*$/, function(resource) {
            resource.request = path.resolve(__dirname, 'src/browser/', "empty.js")
        }),
        new webpack.NormalModuleReplacementPlugin(/.+AnyHTTPPeer$/, function(resource) {
            resource.request = path.resolve(__dirname, 'src/browser/', "empty.js")
        }),
        new webpack.NormalModuleReplacementPlugin(/^fs$/, function(resource) {
            resource.request = path.resolve(__dirname, 'src/browser/', "empty.js")
        }),
        // extends
        new webpack.NormalModuleReplacementPlugin(/.+utils$/, function(resource) {
            if(resource.context.match(/.+browser$/)) {
                return;
            }
            resource.request = path.resolve(__dirname, 'src/browser/', "utils.js")
        })
    ]
};