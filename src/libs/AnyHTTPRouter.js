module.exports = class AnyHTTPRouter {
    constructor() {
        this.routes = {
            _: [] // default ANY route
        };
        this.routesRegexp = {
            _: []  // default ANY route
        };
        this._upgradeCallback = null;

        this._process = this._process.bind(this);
        this._processUpgrade = this._processUpgrade.bind(this);
    }

    on(method, path, callback) {
        if (path instanceof RegExp) {
            if(!this.routesRegexp[method])
                this.routesRegexp[method] = [];
            this.routesRegexp[method].push({
                path: path,
                cb: callback
            });
        } else {
            if(!this.routes[method])
                this.routes[method] = {};

            this.routes[method][path] = callback
        }

        return this;
    }

    upgrade(callback) {
        this._upgradeCallback = callback;
        return this;
    }

    static(url, directory) {
        if(url[0] != "/") {
            url = "/" + url;
        }
        if(!directory) {
            directory = url;
            if(directory[0] == "/") {
                directory = "." + directory;
            }
        }

        return this.on("get", new RegExp("^" + url + "/(.*)$"), (peer) => {
            peer.serveFile(directory + peer.url.split(url).splice(1).join(url));
        });
    }

    any(path, callback) {
        return this.on("_", path, callback);
    }

    get(path, callback) {
        return this.on("get", path, callback);
    }

    post(path, callback) {
        return this.on("post", path, callback);
    }

    delete(path, callback) {
        return this.on("delete", path, callback);
    }

    error(callback) {
        this.onError = callback;
    }

    _processUpgrade(peer) {
        try {
            if(!this._upgradeCallback)
                return;

            this._upgradeCallback(peer);
        }
        catch (e) {
            return this._finish(peer, e);
        }
    }

    _process(peer) {
        try {
            if (this.routes._[peer.url]) {
                this.routes._[peer.url](peer);
                return true;
            }

            if (this.routes[peer.query.method] && this.routes[peer.query.method][peer.url]) {
                this.routes[peer.query.method][peer.url](peer);
                return true;
            }

            for (let item of this.routesRegexp._) {
                if (item.path.test(peer.url)) {
                    item.cb(peer);
                    return true;
                }
            }

            if (this.routesRegexp[peer.query.method]) {
                for (let item of this.routesRegexp[peer.query.method]) {
                    if (item.path.test(peer.url)) {
                        item.cb(peer);
                        return true;
                    }
                }
            }
        }
        catch(e) {
            return this._finish(peer, e);
        }

        this._finish(peer, new Error("No route for path: '"+ peer.url +"'"));
    }
    _finish(peer, error) {
        if(this.onError) {
            this.onError(peer, error);
        }

        if(!peer.isClosed()) {
            peer
                .status(404)
                .end();
        }
    }
};