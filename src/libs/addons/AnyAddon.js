module.exports = (baseDirectory) => {
    return class AnyAddon {
        constructor(anysocket, networkID) {
            this.anysocket = anysocket;
            this.NETWORK_COMMAND = networkID;
            this.applyAnySocketExtension();
        }

        getAnySocketExtension() {
            try {
                return require(baseDirectory + "/AnySocket.extension.js");
            }
            catch {
                return null;
            }
        }

        getAnyPeerExtension() {
            try {
                return require(baseDirectory + "/AnyPeer.extension.js");
            }
            catch {
                return null;
            }
        }

        applyAnySocketExtension() {
            let extension = this.getAnySocketExtension();
            if(!extension) {
                return;
            }

            extension = extension(this.NETWORK_COMMAND);
            if(extension.init) {
                extension.init.bind(this.anysocket)();
            }
            for(let key in extension) {
                if(!this._canExposeKey(key))
                    continue;

                this.anysocket[key] = extension[key].bind(this.anysocket);
            }
        }

        applyAnyPeerExtension(anypeer) {
            let extension = this.getAnyPeerExtension();
            if(!extension) {
                return;
            }

            extension = extension(this.NETWORK_COMMAND);
            if(extension.init) {
                extension.init.bind(anypeer)();
            }
            for(let key in extension) {
                if(!this._canExposeKey(key))
                    continue;

                anypeer[key] = extension[key].bind(anypeer);
            }
        }

        onInternalNetwork(packet) {

        }

        onPeerConnected(peer) {

        }

        onPeerDisconnected(peer) {

        }

        _canExposeKey(key) {
            if([
                "init"
            ].indexOf(key) !== -1)
                return false;
            return true;
        }
    }
}