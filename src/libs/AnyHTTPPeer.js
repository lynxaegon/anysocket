const httpResult = Symbol("httpResult");
const reqSymbol = Symbol("req");
const resSymbol = Symbol("res");
const endSymbol = Symbol("ended");
const parseCookies = Symbol("parseCookies");
const debug = require('debug')('AnyHTTPPeer');

const url = require('url');
//////////////////////////////////////////////////////////////
// TODO: implement `formidable` package for parsing requests
// https://www.npmjs.com/package/formidable
//////////////////////////////////////////////////////////////

module.exports = class AnyHTTPPeer {
    constructor(req, res) {
        let self = this;
        let qs = url.parse(req.url, true);

        self[reqSymbol] = req;
        self[resSymbol] = res;
        self[httpResult] = {
            _headers: {},
            _body: [],
            _cookies: [],
            _url: qs.pathname,
            _query: {
                headers: req.headers,
                cookies: req.headers.cookie,
                method: req.method.toLowerCase(),
                body: req.body,
                qs: qs.query
            },
            _status: 200
        };
        self[endSymbol] = false;
        self[parseCookies] = (cookies) => {
            const list = {};

            cookies && cookies.split(';').forEach(function( cookie ) {
                const parts = cookie.split('=');
                list[parts.shift().trim()] = decodeURI(parts.join('='));
            });

            self[httpResult]._cookies = list;
            return list;
        }
    }

    get url() {
        return this[httpResult]._url;
    }

    get query() {
        return this[httpResult]._query;
    }

    get cookies() {
        return this[parseCookies](this.query.cookies);
    }

    status(code) {
        if (this.isClosed()) {
            debug("Connection already ended!");
            return this;
        }

        this[httpResult]._status = code;
        return this;
    }

    header(name, body) {
        if (this.isClosed()) {
            debug("Connection already ended!");
            return this;
        }

        this[httpResult]._headers[name] = body;
        return this;
    }

    body(chunk) {
        if (this.isClosed()) {
            debug("Connection already ended!");
            return this;
        }

        this[httpResult]._body.push(chunk);
        return this;
    }

    setCookie(key, value, expires) {
        this[httpResult]._cookies[key] = {
            value: value,
            expires: expires
        };
        return this;
    }

    deleteCookie(key) {
        this[httpResult]._cookies[key] = {
            value: "",
            expires: 1
        };
        return this;
    }

    end() {
        if (this.isClosed()) {
            debug("Connection already ended!");
            return this;
        }

        if(Object.keys(this[httpResult]._cookies) > 0) {
            let cookie = [];
            for(let key in this[httpResult]._cookies) {
                if(!this[httpResult]._cookies.hasOwnProperty(key))
                    continue;

                let c = this[httpResult]._cookies[key];
                cookie.push(
                    key + ":" + c.value +
                    (c.expires ? ";" + (new Date(c.expires)).toUTCString() : "")
                );
            }
            this.header("Cookie", cookie.join(";"));
        }
        this[resSymbol].writeHead(this[httpResult]._status, this[httpResult]._headers);
        this[endSymbol] = true;

        if (this[httpResult]._body.length > 0)
            for (let i in this[httpResult]._body) {
                if (!this[httpResult]._body.hasOwnProperty(i))
                    continue;
                this[resSymbol].write(this[httpResult]._body[i]);
            }

        this[resSymbol].end();
    }

    isClosed() {
        return this[endSymbol];
    }
};