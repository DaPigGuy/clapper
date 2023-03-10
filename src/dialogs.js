const { Adw, Gdk, Gio, GObject, Gst, Gtk } = imports.gi;
const System = imports.system;
const Debug = imports.src.debug;
const FileOps = imports.src.fileOps;
const Misc = imports.src.misc;

const { debug } = Debug;

var FileChooser = GObject.registerClass({
    GTypeName: 'ClapperFileChooser',
},
class ClapperFileChooser extends Gtk.FileChooserNative
{
    _init(window, purpose)
    {
        super._init({
            transient_for: window,
            modal: true,
        });

        switch(purpose) {
            case 'open_local':
                this._prepareOpenLocal();
                break;
            case 'export_playlist':
                this._prepareExportPlaylist();
                break;
            default:
                debug(new Error(`unknown file chooser purpose: ${purpose}`));
                break;
        }

        this.chooserPurpose = purpose;

        /* File chooser closes itself when nobody is holding its ref */
        this.ref();
        this.show();
    }

    _prepareOpenLocal()
    {
        this.select_multiple = true;

        const filter = new Gtk.FileFilter({
            name: 'Media Files',
        });
        filter.add_mime_type('video/*');
        filter.add_mime_type('audio/*');
        filter.add_mime_type('application/claps');
        Misc.subsMimes.forEach(mime => filter.add_mime_type(mime));
        this.add_filter(filter);
    }

    _prepareExportPlaylist()
    {
        this.action = Gtk.FileChooserAction.SAVE;
        this.set_current_name('playlist.claps');

        const filter = new Gtk.FileFilter({
            name: 'Playlist Files',
        });
        filter.add_mime_type('application/claps');
        this.add_filter(filter);
    }

    vfunc_response(respId)
    {
        debug('closing file chooser dialog');

        if(respId === Gtk.ResponseType.ACCEPT) {
            switch(this.chooserPurpose) {
                case 'open_local':
                    this._handleOpenLocal();
                    break;
                case 'export_playlist':
                    this._handleExportPlaylist();
                    break;
            }
        }

        this.unref();
        this.destroy();
    }

    _handleOpenLocal()
    {
        const files = this.get_files();
        const filesArray = [];

        let index = 0;
        let file;

        while((file = files.get_item(index))) {
            filesArray.push(file);
            index++;
        }

        const { application } = this.transient_for;
        const isHandlesOpen = Boolean(
            application.flags & Gio.ApplicationFlags.HANDLES_OPEN
        );

        /* Remote app does not handle open */
        if(isHandlesOpen)
           application.open(filesArray, "");
        else
           application._openFilesAsync(filesArray);
    }

    _handleExportPlaylist()
    {
        const file = this.get_file();
        const { playlistWidget } = this.transient_for.child.player;
        const playlist = playlistWidget.getPlaylist(true);

        FileOps.saveFileSimplePromise(file, playlist.join('\n'))
            .then(() => {
                debug(`exported playlist to file: ${file.get_path()}`);
            })
            .catch(err => {
                debug(err);
            });
    }
});

var UriDialog = GObject.registerClass({
    GTypeName: 'ClapperUriDialog',
},
class ClapperUriDialog extends Gtk.Dialog
{
    _init(window)
    {
        super._init({
            transient_for: window,
            modal: true,
            use_header_bar: true,
            title: _('Open URI'),
            default_width: 420,
        });

        const contentBox = this.get_content_area();
        contentBox.vexpand = true;
        contentBox.add_css_class('uridialogbox');

        const linkEntry = new Gtk.Entry({
            activates_default: true,
            truncate_multiline: true,
            height_request: 38,
            hexpand: true,
            valign: Gtk.Align.CENTER,
            input_purpose: Gtk.InputPurpose.URL,
            placeholder_text: _('Enter or drop URI here'),
        });
        linkEntry.connect('notify::text', this._onTextNotify.bind(this));
        contentBox.append(linkEntry);

        this.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        this.add_button(_('Open'), Gtk.ResponseType.OK);

        this.set_default_response(Gtk.ResponseType.OK);
        this.set_response_sensitive(Gtk.ResponseType.OK, false);

        const display = Gdk.Display.get_default();
        const clipboard = (display) ? display.get_clipboard() : null;

        if(clipboard)
            clipboard.read_text_async(null, this._readTextAsyncCb.bind(this));

        this.show();
    }

    vfunc_response(respId)
    {
        if(respId === Gtk.ResponseType.OK) {
            const contentBox = this.get_content_area();
            const linkEntry = contentBox.get_last_child();
            const { player } = this.transient_for.child;

            player.set_playlist([linkEntry.text]);
        }

        this.destroy();
    }

    _onTextNotify(entry)
    {
        const isUriValid = (entry.text.length)
            ? Gst.uri_is_valid(entry.text)
            : false;

        this.set_response_sensitive(Gtk.ResponseType.OK, isUriValid);
    }

    _readTextAsyncCb(clipboard, result)
    {
        let uri = null;

        try {
            uri = clipboard.read_text_finish(result);
        }
        catch(err) {
            debug(`could not read clipboard: ${err.message}`);
        }

        if(!uri || !Gst.uri_is_valid(uri))
            return;

        const contentBox = this.get_content_area();
        const linkEntry = contentBox.get_last_child();

        linkEntry.set_text(uri);
        linkEntry.select_region(0, -1);
    }
});

var ResumeDialog = GObject.registerClass({
    GTypeName: 'ClapperResumeDialog',
},
class ClapperResumeDialog extends Adw.MessageDialog
{
    _init(window, resumeInfo)
    {
        const percentage = Math.round((resumeInfo.time / resumeInfo.duration) * 100);

        const msg = [
            '<b>' + _('Title') + `:</b> ${resumeInfo.title}`,
            '<b>' + _('Completed') + `:</b> ${percentage}%`
        ].join('\n');

        super._init({
            transient_for: window,
            modal: true,
            heading: _('Resume Playback?'),
            body_use_markup: true,
            body: msg,
        });

        this.add_response('cancel', _('Cancel'));
        this.add_response('resume', _('Resume'));
        this.set_close_response('cancel');
        this.set_default_response('resume');
        this.set_response_appearance('resume', Adw.ResponseAppearance.SUGGESTED);

        this.resumeInfo = resumeInfo;

        this.show();
    }

    vfunc_response(respId)
    {
        const { player } = this.transient_for.child;

        if(respId === 'resume')
            player.seek_seconds(this.resumeInfo.time);

        this.destroy();
    }
});

function showAboutDialog(window)
{
    const gstVer = [
        Gst.VERSION_MAJOR, Gst.VERSION_MINOR, Gst.VERSION_MICRO
    ].join('.');

    const gtkVer = [
        Gtk.MAJOR_VERSION, Gtk.MINOR_VERSION, Gtk.MICRO_VERSION
    ].join('.');

    const adwVer = [
        Adw.MAJOR_VERSION, Adw.MINOR_VERSION, Adw.MICRO_VERSION
    ].join('.');

    const gjsVerStr = String(System.version);
    let gjsVer = '';

    gjsVer += gjsVerStr.charAt(0) + '.';
    gjsVer += gjsVerStr.charAt(1) + gjsVerStr.charAt(2) + '.';
    if(gjsVerStr.charAt(3) !== '0')
        gjsVer += gjsVerStr.charAt(3);
    gjsVer += gjsVerStr.charAt(4);

    const osInfo = [
        _('GTK version: %s').format(gtkVer),
        _('Adwaita version: %s').format(adwVer),
        _('GStreamer version: %s').format(gstVer),
        _('GJS version: %s').format(gjsVer)
    ].join('\n');

    const aboutWindow = new Adw.AboutWindow({
        transient_for: window,
        application_name: Misc.appName,
        version: pkg.version,
        developer_name: 'Rafał Dzięgiel',
        developers: ['Rafał Dzięgiel'],
        artists: ['Rafał Dzięgiel'],
        /* TRANSLATORS: Put your name(s) here for credits or leave untranslated */
        translator_credits: _('translator-credits'),
        license_type: Gtk.License.GPL_3_0,
        application_icon: 'com.github.rafostar.Clapper',
        website: 'https://rafostar.github.io/clapper',
        issue_url: 'https://github.com/Rafostar/clapper/issues/new',
        debug_info: osInfo,
    });

    aboutWindow.show();
}
