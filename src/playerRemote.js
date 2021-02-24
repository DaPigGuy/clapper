const { GObject } = imports.gi;
const { WebClient } = imports.src.webClient;

var ClapperState = {
    STOPPED: 0,
    BUFFERING: 1,
    PAUSED: 2,
    PLAYING: 3,
};

var PlayerRemote = GObject.registerClass(
class ClapperPlayerRemote extends GObject.Object
{
    _init()
    {
        super._init();

        this.webclient = new WebClient();
    }

    set_playlist(playlist)
    {
        const uris = [];

        /* We can not send GioFiles via WebSocket */
        for(let source of playlist) {
            const uri = (source.get_uri != null)
                ? source.get_uri()
                : source;

            uris.push(uri);
        }

        this.webclient.sendMessage({
            action: 'set_playlist',
            value: uris
        });
    }
});
