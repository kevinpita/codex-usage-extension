import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Cairo from 'cairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const USAGE_API_URL = 'https://chatgpt.com/backend-api/wham/usage';
const RESET_CREDITS_API_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const USAGE_SETTINGS_URL = 'https://chatgpt.com/#settings/Usage';
const TRACK_WIDTH = 300;
const PANEL_BAR_WIDTH = 34;
const RING_SIZE = 18;
const RING_WIDTH = 3;
const FIVE_HOUR_SECONDS = 5 * 3600;
const SEVEN_DAY_SECONDS = 7 * 24 * 3600;

function severity(util) {
    if (util >= 90)
        return 'usage-critical';
    if (util >= 75)
        return 'usage-high';
    return 'usage-low';
}

function severityRgb(util) {
    if (util >= 90)
        return [0.88, 0.11, 0.14];
    if (util >= 75)
        return [1.0, 0.47, 0.0];
    return [0.2, 0.82, 0.48];
}

function colorRgb(c) {
    const scale = Math.max(c.red, c.green, c.blue) > 1 ? 255 : 1;
    return [c.red / scale, c.green / scale, c.blue / scale];
}

function humanDuration(seconds, sep = ' ') {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60)
        return `${s}s`;
    const mins = Math.round(s / 60);
    if (mins < 60)
        return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)
        return `${hrs}h${sep}${mins % 60}m`;
    const days = Math.floor(hrs / 24);
    return `${days}d${sep}${hrs % 24}h`;
}

function relativeReset(iso) {
    const target = Date.parse(iso ?? '');
    if (Number.isNaN(target))
        return '';
    const diff = target - Date.now();
    if (diff <= 0)
        return 'resetting...';
    return `resets in ${humanDuration(diff / 1000)}`;
}

function expiresIn(iso) {
    const target = Date.parse(iso ?? '');
    if (Number.isNaN(target))
        return '';
    const diff = target - Date.now();
    if (diff <= 0)
        return 'expired';
    return `expires in ${humanDuration(diff / 1000)}`;
}

function projectedUtil(util, resetsAtIso, totalSeconds) {
    const target = Date.parse(resetsAtIso ?? '');
    if (Number.isNaN(target) || !totalSeconds)
        return util;
    const remaining = (target - Date.now()) / 1000;
    if (remaining <= 0)
        return util;
    const elapsed = totalSeconds - remaining;
    if (elapsed <= 0 || elapsed / totalSeconds < 0.05)
        return util;
    return Math.max(util, (util * totalSeconds) / elapsed);
}

function exhaustSeconds(util, resetsAtIso, totalSeconds) {
    const target = Date.parse(resetsAtIso ?? '');
    if (Number.isNaN(target) || !totalSeconds || util <= 0)
        return null;
    const remaining = (target - Date.now()) / 1000;
    if (remaining <= 0)
        return null;
    const elapsed = totalSeconds - remaining;
    if (elapsed <= 0 || elapsed / totalSeconds < 0.05)
        return null;
    const toExhaust = (elapsed * (100 - util)) / util;
    return toExhaust > 0 && toExhaust < remaining ? toExhaust : null;
}

function planLabel(value) {
    const raw = `${value ?? ''}`.trim();
    if (!raw)
        return 'CODEX';
    const normalized = raw.toLowerCase().replace(/[\s_-]/g, '');
    const known = [
        ['prolite', 'PRO X5'],
        ['pro', 'PRO X20'],
        ['plus', 'PLUS'],
        ['free', 'FREE'],
        ['max', 'MAX'],
        ['team', 'TEAM'],
        ['business', 'BUSINESS'],
        ['enterprise', 'ENT'],
        ['edu', 'EDU'],
    ];
    for (const [key, label] of known) {
        if (normalized.includes(key))
            return label;
    }
    return raw.toUpperCase();
}

class Meter {
    constructor(name) {
        this.root = new St.BoxLayout({vertical: true, style_class: 'codex-meter'});

        const row = new St.BoxLayout({style_class: 'codex-meter-row'});
        this._name = new St.Label({text: name, style_class: 'codex-meter-name', x_expand: true});
        this._pct = new St.Label({text: '...', style_class: 'codex-meter-pct'});
        row.add_child(this._name);
        row.add_child(this._pct);

        this._track = new St.BoxLayout({style_class: 'codex-track'});
        this._fill = new St.Widget({style_class: 'codex-fill usage-low'});
        this._track.add_child(this._fill);

        this._caption = new St.Label({text: '', style_class: 'codex-caption'});
        this._note = new St.Label({text: '', style_class: 'codex-note'});
        this._note.clutter_text.line_wrap = true;
        this._note.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._note.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        this.root.add_child(row);
        this.root.add_child(this._track);
        this.root.add_child(this._caption);
        this.root.add_child(this._note);
    }

    setValue(util, caption, colorUtil = util, displayValue = util, displaySuffix = 'used', note = null) {
        const clamped = Math.max(0, Math.min(100, util));
        this._pct.text = `${displayValue.toFixed(1)}% ${displaySuffix}`;
        this._fill.set_width(Math.round((clamped / 100) * TRACK_WIDTH));
        this._fill.style_class = `codex-fill ${severity(colorUtil)}`;
        this._caption.text = caption ?? '';
        this._caption.visible = !!caption;
        this._note.text = note?.text ?? '';
        this._note.visible = !!note?.text;
        this._note.style_class = note?.warn ? 'codex-note codex-note-warn' : 'codex-note';
    }

    setMuted(detail = '-') {
        this._pct.text = detail;
        this._fill.set_width(0);
        this._fill.style_class = 'codex-fill';
        this._caption.visible = false;
        this._note.visible = false;
    }
}

const Ring = GObject.registerClass(
class Ring extends St.DrawingArea {
    _init() {
        super._init({
            style_class: 'codex-ring',
            width: RING_SIZE,
            height: RING_SIZE,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._util = null;
        this._color = null;
    }

    setValue(util, colorUtil = util) {
        this._util = Math.max(0, Math.min(100, util));
        this._color = severityRgb(colorUtil);
        this.queue_repaint();
    }

    setUnknown() {
        this._util = null;
        this._color = null;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - RING_WIDTH / 2;
        const start = -Math.PI / 2;

        cr.setLineWidth(RING_WIDTH);
        cr.setLineCap(Cairo.LineCap.ROUND);

        const [fr, fg, fb] = colorRgb(this.get_theme_node().get_foreground_color());
        cr.setSourceRGBA(fr, fg, fb, 0.22);
        cr.arc(cx, cy, radius, 0, 2 * Math.PI);
        cr.stroke();

        if (this._util !== null && this._util > 0) {
            const [r, g, b] = this._color ?? severityRgb(this._util);
            cr.setSourceRGBA(r, g, b, 1);
            cr.arc(cx, cy, radius, start, start + (this._util / 100) * 2 * Math.PI);
            cr.stroke();
        }

        cr.$dispose();
    }
});

class PanelBar {
    constructor() {
        this.root = new St.BoxLayout({
            style_class: 'codex-panel-bar',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fill = new St.Widget({style_class: 'codex-panel-bar-fill'});
        this.root.add_child(this._fill);
    }

    setValue(util, colorUtil = util) {
        const clamped = Math.max(0, Math.min(100, util));
        this._fill.set_width(Math.round((clamped / 100) * PANEL_BAR_WIDTH));
        this._fill.style_class = `codex-panel-bar-fill ${severity(colorUtil)}`;
    }

    setUnknown() {
        this._fill.set_width(0);
        this._fill.style_class = 'codex-panel-bar-fill';
    }
}

const CodexUsageIndicator = GObject.registerClass(
class CodexUsageIndicator extends PanelMenu.Button {
    _init(extensionPath, settings, openPreferences) {
        super._init(0.0, 'Codex Usage Indicator');

        this._extensionPath = extensionPath;
        this._settings = settings;
        this._openPreferences = openPreferences;
        this._session = this._createSession();
        this._lastUsage = null;
        this._countdownTimer = null;

        const box = new St.BoxLayout({style_class: 'codex-panel'});
        const iconPath = GLib.build_filenamev([this._extensionPath, 'codex-icon-22.png']);
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            style_class: 'codex-panel-icon',
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._ring = new Ring();
        this._panelBar = new PanelBar();
        this._label = new St.Label({
            text: '...',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'codex-panel-pct',
        });
        this._panelTier = new St.Label({
            text: 'CODEX',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'codex-panel-tier',
        });

        box.add_child(this._icon);
        box.add_child(this._ring);
        box.add_child(this._panelBar.root);
        box.add_child(this._label);
        box.add_child(this._panelTier);
        this.add_child(box);

        this._createMenu();

        this._updateDisplayMode();
        this._updateIconVisibility();
        this._updateIconStyle();
        this._updateUsageTitles();

        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'refresh-interval') {
                this._restartTimer();
            } else if (key === 'display-mode') {
                this._updateDisplayMode();
            } else if (key === 'show-icon') {
                this._updateIconVisibility();
            } else if (key === 'icon-style') {
                this._updateIconStyle();
            } else if (key === 'proxy-url') {
                this._recreateSession();
            } else if (key === 'usage-display') {
                this._updateUsageTitles();
                this._renderFromLastUsage();
            } else if (key === 'show-additional-limits') {
                this._renderFromLastUsage();
            } else if (key === 'panel-window' || key === 'show-tier') {
                this._renderPanel();
            }
        });

        this.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._refreshUsage();
        }, this);

        this._refreshUsage();
        this._startTimer();
    }

    _updateDisplayMode() {
        const mode = this._settings.get_string('display-mode');
        this._ring.visible = mode === 'ring';
        this._panelBar.root.visible = mode === 'bar' || mode === 'both';
        this._label.visible = mode === 'text' || mode === 'both' || mode === 'ring';
        this._panelTier.visible = this._settings.get_boolean('show-tier');
    }

    _updateIconVisibility() {
        this._icon.visible = this._settings.get_boolean('show-icon');
    }

    _updateIconStyle() {
        const style = this._settings.get_string('icon-style');
        const desatName = 'monochrome-desaturate';
        const brightName = 'monochrome-brightness';
        const hasEffect = this._icon.get_effect(desatName) !== null;

        if (style === 'monochrome' && !hasEffect) {
            this._icon.add_effect(new Clutter.DesaturateEffect({factor: 1.0, name: desatName}));
            const brightnessEffect = new Clutter.BrightnessContrastEffect({name: brightName});
            brightnessEffect.set_brightness_full(1, 1, 1);
            this._icon.add_effect(brightnessEffect);
        } else if (style !== 'monochrome' && hasEffect) {
            this._icon.remove_effect_by_name(desatName);
            this._icon.remove_effect_by_name(brightName);
        }
    }

    _createSession() {
        const session = new Soup.Session();
        const proxyUrl = this._settings.get_string('proxy-url').trim();

        if (proxyUrl !== '') {
            const proxyResolver = Gio.SimpleProxyResolver.new(proxyUrl, null);
            session.set_proxy_resolver(proxyResolver);
        }

        return session;
    }

    _recreateSession() {
        this._session?.abort();
        this._session = this._createSession();
        this._refreshUsage();
    }

    _createMenu() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'codex-popup',
        });
        item.add_child(root);
        this.menu.addMenuItem(item);

        const header = new St.BoxLayout({style_class: 'codex-header'});
        const logo = new St.Icon({
            gicon: Gio.icon_new_for_string(GLib.build_filenamev([this._extensionPath, 'codex-icon-22.png'])),
            style_class: 'codex-logo',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const who = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._title = new St.Label({
            text: 'Codex',
            style_class: 'codex-title',
        });
        this._subtitle = new St.Label({
            text: 'usage monitor',
            style_class: 'codex-subtitle',
        });
        who.add_child(this._title);
        who.add_child(this._subtitle);
        this._tierPill = new St.Label({
            text: 'CODEX',
            style_class: 'codex-pill',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(logo);
        header.add_child(who);
        header.add_child(this._tierPill);
        root.add_child(header);

        root.add_child(new St.Label({
            text: 'USAGE LIMITS',
            style_class: 'codex-section-label',
        }));

        this._fiveHourMeter = new Meter('5-hour window');
        this._weeklyMeter = new Meter('7-day window');
        root.add_child(this._fiveHourMeter.root);
        root.add_child(this._weeklyMeter.root);

        this._additionalBox = new St.BoxLayout({vertical: true});
        this._additionalBox.visible = false;
        root.add_child(this._additionalBox);

        root.add_child(new St.Label({
            text: 'PENDING RESETS',
            style_class: 'codex-section-label',
        }));
        this._resetList = new St.BoxLayout({
            vertical: true,
            style_class: 'codex-reset-list',
        });
        root.add_child(this._resetList);

        this._error = new St.Label({
            text: '',
            style_class: 'codex-error',
        });
        this._error.visible = false;
        root.add_child(this._error);

        const actions = new St.BoxLayout({style_class: 'codex-actions'});
        const openUsage = new St.Button({
            label: 'Usage page',
            style_class: 'codex-button codex-button-primary',
            x_expand: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        openUsage.connect('clicked', () => {
            this.menu.close();
            Gio.AppInfo.launch_default_for_uri(USAGE_SETTINGS_URL, null);
        });
        actions.add_child(openUsage);
        root.add_child(actions);

        const footer = new St.BoxLayout({style_class: 'codex-footer'});
        this._lastUpdatedLabel = new St.Label({
            text: 'Loading...',
            style_class: 'codex-updated',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        footer.add_child(this._lastUpdatedLabel);

        const settingsButton = new St.Button({
            label: 'Settings',
            style_class: 'codex-footer-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        settingsButton.connect('clicked', () => {
            this.menu.close();
            this._openPreferences();
        });
        footer.add_child(settingsButton);

        const refreshButton = new St.Button({
            label: 'Refresh',
            style_class: 'codex-footer-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        refreshButton.connect('clicked', () => this._refreshUsage());
        footer.add_child(refreshButton);
        root.add_child(footer);
    }

    _startTimer() {
        const interval = this._settings.get_int('refresh-interval');
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._refreshUsage();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    _restartTimer() {
        this._stopTimer();
        this._startTimer();
    }

    _refreshUsage() {
        const codexHome = GLib.getenv('CODEX_HOME') ??
            GLib.build_filenamev([GLib.get_home_dir(), '.codex']);
        const authPath = GLib.build_filenamev([codexHome, 'auth.json']);

        const file = Gio.File.new_for_path(authPath);
        file.load_contents_async(null, (file, result) => {
            try {
                const [, contents] = file.load_contents_finish(result);
                const decoder = new TextDecoder('utf-8');
                const auth = JSON.parse(decoder.decode(contents));
                const tokens = auth.tokens ?? auth;
                const accessToken = tokens.access_token ?? null;
                const accountId = tokens.account_id ?? null;

                if (!accessToken) {
                    this._setUnavailableState('-', 'Login required');
                    this._updateLastCheckedLabel(false);
                    return;
                }

                this._fetchUsage(accessToken, accountId);
            } catch (e) {
                console.error('Codex Usage: Failed to read auth:', e.message);
                this._setUnavailableState('-', 'No auth');
                this._updateLastCheckedLabel(false);
            }
        });
    }

    _newApiMessage(url, accessToken, accountId) {
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('Authorization', `Bearer ${accessToken}`);
        message.request_headers.append('User-Agent', 'codex-cli');
        if (accountId)
            message.request_headers.append('ChatGPT-Account-Id', accountId);
        return message;
    }

    _fetchUsage(accessToken, accountId) {
        const message = this._newApiMessage(USAGE_API_URL, accessToken, accountId);

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);

                    if (message.status_code !== 200) {
                        this._setUnavailableState('!', `HTTP ${message.status_code}`);
                        this._updateLastCheckedLabel(false);
                        return;
                    }

                    const decoder = new TextDecoder('utf-8');
                    const data = JSON.parse(decoder.decode(bytes.get_data()));

                    if (!data.rate_limit) {
                        this._setUnavailableState('-', 'No data');
                        this._updateLastCheckedLabel(true);
                        return;
                    }
                    this._fetchResetCredits(accessToken, accountId, this._normalizeApiResponse(data));
                } catch (e) {
                    console.error('Codex Usage: API request failed:', e.message);
                    this._setUnavailableState('!', 'API failed');
                    this._updateLastCheckedLabel(false);
                }
            }
        );
    }

    _fetchResetCredits(accessToken, accountId, usage) {
        const message = this._newApiMessage(RESET_CREDITS_API_URL, accessToken, accountId);

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.status_code === 200) {
                        const decoder = new TextDecoder('utf-8');
                        const data = JSON.parse(decoder.decode(bytes.get_data()));
                        usage.resetCreditDetails = (data.credits ?? [])
                            .filter(credit => credit?.status === 'available')
                            .map(credit => ({
                                title: credit.title || 'Full reset',
                                expiresAt: credit.expires_at ?? null,
                            }));
                    }
                } catch (e) {
                    console.error('Codex Usage: Reset credits request failed:', e.message);
                }
                this._render(usage);
                this._updateLastCheckedLabel(true);
            }
        );
    }

    _normalizeWindow(win) {
        return {
            utilization: this._usedPercent(win?.used_percent),
            resets_at: win?.reset_at
                ? new Date(win.reset_at * 1000).toISOString()
                : null,
        };
    }

    _normalizeApiResponse(data) {
        const rl = data.rate_limit;
        return {
            tier: planLabel(data.plan_type ?? rl.plan ?? rl.subscription_type ?? rl.rate_limit_tier ?? rl.tier),
            primary: this._normalizeWindow(rl.primary_window),
            secondary: this._normalizeWindow(rl.secondary_window),
            additional: (data.additional_rate_limits ?? [])
                .filter(entry => entry?.rate_limit)
                .map(entry => ({
                    name: `${entry.limit_name ?? 'additional'}`.toUpperCase(),
                    primary: this._normalizeWindow(entry.rate_limit.primary_window),
                    secondary: this._normalizeWindow(entry.rate_limit.secondary_window),
                })),
            resetCredits: data.rate_limit_reset_credits?.available_count ?? 0,
        };
    }

    _setUnavailableState(label, detail) {
        this._lastUsage = null;
        this._label.set_text(label);
        this._label.style_class = 'codex-panel-pct usage-high';
        this._ring.setUnknown();
        this._panelBar.setUnknown();
        this._fiveHourMeter.setMuted(detail);
        this._weeklyMeter.setMuted('-');
        this._additionalBox.destroy_all_children();
        this._additionalBox.visible = false;
        this._setResetListEmpty('-');
        this._error.text = detail;
        this._error.visible = true;
        this._scheduleCountdown();
    }

    _render(data) {
        this._lastUsage = data;
        this._error.visible = false;
        this._tierPill.text = data.tier;
        this._panelTier.text = data.tier;
        this._subtitle.text = data.tier === 'CODEX' ? 'usage monitor' : `${data.tier} limits`;

        this._updateUsageTitles();
        this._applyWindow(this._fiveHourMeter, data.primary, FIVE_HOUR_SECONDS);
        this._applyWindow(this._weeklyMeter, data.secondary, SEVEN_DAY_SECONDS);
        this._renderAdditional(data);
        this._updateResetSummary(data);
        this._renderPanel();
        this._scheduleCountdown();
    }

    _renderFromLastUsage() {
        if (this._lastUsage)
            this._render(this._lastUsage);
    }

    _renderAdditional(data) {
        this._additionalBox.destroy_all_children();
        const limits = data.additional ?? [];
        this._additionalBox.visible =
            this._settings.get_boolean('show-additional-limits') && limits.length > 0;
        if (!this._additionalBox.visible)
            return;

        for (const limit of limits) {
            this._additionalBox.add_child(new St.Label({
                text: limit.name,
                style_class: 'codex-section-label',
            }));
            const fiveHour = new Meter('5-hour window');
            const weekly = new Meter('7-day window');
            this._applyWindow(fiveHour, limit.primary, FIVE_HOUR_SECONDS);
            this._applyWindow(weekly, limit.secondary, SEVEN_DAY_SECONDS);
            this._additionalBox.add_child(fiveHour.root);
            this._additionalBox.add_child(weekly.root);
        }
    }

    _applyWindow(meter, win, totalSeconds) {
        if (!win) {
            meter.setMuted();
            return;
        }

        const util = this._usedPercent(win.utilization);
        const proj = projectedUtil(util, win.resets_at, totalSeconds);
        const display = this._displayPercent(util);
        const displaySuffix = this._usageDisplayMode() === 'remaining' ? 'remaining' : 'used';
        const caption = win.resets_at ? relativeReset(win.resets_at)
            : (util > 0 ? '' : 'not used yet');

        const exhaust = exhaustSeconds(util, win.resets_at, totalSeconds);
        let note = null;
        if (exhaust !== null) {
            note = {text: `burning fast - out in ~${humanDuration(exhaust)} at this rate`, warn: true};
        } else if (Math.round(proj) > Math.round(util)) {
            const pace = Math.min(100, Math.round(proj));
            let text = `at this rate you'll hit ~${pace}% by reset`;
            if (proj > 0 && proj < 75) {
                const headroom = 100 / proj;
                text += ` - you can push ~${headroom >= 10 ? Math.round(headroom) : headroom.toFixed(1)}x harder`;
            }
            note = {text, warn: severity(proj) !== 'usage-low'};
        }

        meter.setValue(util, caption, proj, display, displaySuffix, note);
    }

    _addResetRow(name, value) {
        const row = new St.BoxLayout({style_class: 'codex-reset-row'});
        row.add_child(new St.Label({
            text: name,
            style_class: 'codex-reset-name',
            x_expand: true,
        }));
        row.add_child(new St.Label({
            text: value,
            style_class: 'codex-reset-time',
        }));
        this._resetList.add_child(row);
    }

    _updateResetSummary(data) {
        if (!data.resetCredits) {
            this._setResetListEmpty('none banked');
            return;
        }

        this._resetList.destroy_all_children();
        const details = data.resetCreditDetails ?? [];
        if (details.length === 0) {
            this._addResetRow('banked resets', `${data.resetCredits} available`);
            return;
        }

        for (const credit of details)
            this._addResetRow(credit.title, expiresIn(credit.expiresAt));
    }

    _setResetListEmpty(text) {
        this._resetList.destroy_all_children();
        this._resetList.add_child(new St.Label({
            text,
            style_class: 'codex-reset-empty',
        }));
    }

    _panelWindow() {
        const u = this._lastUsage;
        if (!u)
            return null;
        switch (this._settings.get_string('panel-window')) {
        case 'secondary':
            return {win: u.secondary, total: SEVEN_DAY_SECONDS};
        case 'max': {
            const primaryProj = projectedUtil(u.primary?.utilization ?? -1, u.primary?.resets_at, FIVE_HOUR_SECONDS);
            const secondaryProj = projectedUtil(u.secondary?.utilization ?? -1, u.secondary?.resets_at, SEVEN_DAY_SECONDS);
            return secondaryProj > primaryProj
                ? {win: u.secondary, total: SEVEN_DAY_SECONDS}
                : {win: u.primary, total: FIVE_HOUR_SECONDS};
        }
        case 'primary':
        default:
            return {win: u.primary, total: FIVE_HOUR_SECONDS};
        }
    }

    _renderPanel() {
        this._updateDisplayMode();
        const selected = this._panelWindow();
        if (!selected || !selected.win) {
            this._label.text = '-';
            this._label.style_class = 'codex-panel-pct';
            this._ring.setUnknown();
            this._panelBar.setUnknown();
            return;
        }

        const util = this._usedPercent(selected.win.utilization);
        const proj = projectedUtil(util, selected.win.resets_at, selected.total);
        const display = this._displayPercent(util);
        this._label.text = `${Math.round(display)}%`;
        this._label.style_class = `codex-panel-pct ${severity(proj)}`;
        this._ring.setValue(util, proj);
        this._panelBar.setValue(util, proj);
    }

    _scheduleCountdown() {
        if (this._countdownTimer) {
            GLib.source_remove(this._countdownTimer);
            this._countdownTimer = null;
        }

        const soonest = this._soonestResetSeconds();
        if (soonest === null)
            return;

        const interval = soonest < 90 ? 1 : 30;
        this._countdownTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._countdownTimer = null;
            this._renderFromLastUsage();
            return GLib.SOURCE_REMOVE;
        });
    }

    _soonestResetSeconds() {
        let soonest = null;
        for (const win of [this._lastUsage?.primary, this._lastUsage?.secondary]) {
            if (!win?.resets_at)
                continue;
            const target = Date.parse(win.resets_at);
            if (Number.isNaN(target))
                continue;
            const seconds = (target - Date.now()) / 1000;
            if (seconds > 0 && (soonest === null || seconds < soonest))
                soonest = seconds;
        }
        return soonest;
    }

    _coercePercent(value) {
        return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }

    _usedPercent(usedPercent) {
        return Math.min(100, Math.max(0, this._coercePercent(usedPercent)));
    }

    _displayPercent(usedPercent) {
        const normalizedUsage = this._usedPercent(usedPercent);
        if (this._usageDisplayMode() === 'remaining')
            return 100 - normalizedUsage;

        return normalizedUsage;
    }

    _usageDisplayMode() {
        return this._settings.get_string('usage-display');
    }

    _updateUsageTitles() {
        this._fiveHourMeter._name.text = '5-hour window';
        this._weeklyMeter._name.text = '7-day window';
    }

    _updateLastCheckedLabel(success) {
        const now = GLib.DateTime.new_now_local();
        this._lastUpdatedLabel.set_text(`${success ? 'Updated' : 'Checked'} ${now.format('%H:%M:%S')}`);
    }

    destroy() {
        this._stopTimer();
        if (this._countdownTimer) {
            GLib.source_remove(this._countdownTimer);
            this._countdownTimer = null;
        }
        this.menu.disconnectObject(this);
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        super.destroy();
    }
});

export default class CodexUsageExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new CodexUsageIndicator(
            this.path,
            this._settings,
            () => this.openPreferences()
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
