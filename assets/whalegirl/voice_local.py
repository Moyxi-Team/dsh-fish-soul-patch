# -*- coding: utf-8 -*-
"""V-1b：桥内直接录音发送（不依赖 WhaleLauncher.exe 的 --voice-reply-job）。

背景：exe 4.1.2 的语音发送在本机恒报「参数错误。」（失败在打开播放设备，请求未发出），
所以改由桥自己完成整条链路：

    dsh 合成的 mp3（record 段里的 base64）
      → ffmpeg 转 44.1kHz / 16bit / 立体声 WAV
      → UIA 打开目标会话（复用 send_voice_reply 的 prepare）
      → 微信窗口置前台
      → 按住「发语音」热键（默认右 Alt），同时 winmm 把 WAV 播到 Device（CABLE Input）
      → 松开热键，等微信编码上传

配置 data/voice-local.json（缺省即全部默认值）：
    {"enabled": true, "device": "", "hotkey": "rightalt",
     "leadMs": 250, "tailMs": 350, "settleMs": 900}
- enabled=false 时退回 exe 老路径（voice-send.json 的 voiceReplyViaExe 仍兼容）。
- device 为空时用 data/voice-send.json 的 Device。
"""
import ctypes
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
import wave

import engine as G
import ffmpeg_runtime

CONFIG_NAME = 'voice-local.json'
DEFAULT_DEVICE_FALLBACK = 'CABLE Input'

# 常见热键 → (虚拟键码, 是否扩展键)
_HOTKEYS = {
    'rightalt': (0xA5, True),
    'ralt': (0xA5, True),
    'leftalt': (0xA4, False),
    'lalt': (0xA4, False),
    'rightctrl': (0xA3, True),
    'rctrl': (0xA3, True),
}

# [WHALE-VOICE-FOREGROUND] 组合热键：微信「按住说话」可以是 Ctrl+Alt 这类双键，
# 只按单键时微信不会进录音态（表现为语音没发出去但流程以为发了）。
COMBO_KEYS = {
    'ctrl': (0x11, False),
    'control': (0x11, False),
    'leftctrl': (0xA2, False),
    'lctrl': (0xA2, False),
    'rightctrl': (0xA3, True),
    'rctrl': (0xA3, True),
    'alt': (0x12, False),
    'leftalt': (0xA4, False),
    'lalt': (0xA4, False),
    'rightalt': (0xA5, True),
    'ralt': (0xA5, True),
    'shift': (0x10, False),
    'leftshift': (0xA0, False),
    'rightshift': (0xA1, True),
    'win': (0x5B, True),
}

VK_ALT = 0xA5


def _root(root=None):
    return root or G.ROOT


def _read_json(path):
    try:
        with open(path, encoding='utf-8-sig') as f:
            value = json.load(f)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def exe_settings(root=None):
    return _read_json(os.path.join(_root(root), 'data', 'voice-send.json'))


def settings(root=None):
    cfg = _read_json(os.path.join(_root(root), 'data', CONFIG_NAME))
    base = exe_settings(root)
    merged = {
        'enabled': True,
        'device': str(base.get('Device') or ''),
        'hotkey': 'rightalt',
        # [WHALE-VOICE-FOREGROUND] 备用热键：exe 侧记录过微信「按住说话」的快捷键
        # （voice-send.json 的 RecordingHotkey，现场是 Ctrl+Alt）。桥默认只按右 Alt，
        # 若微信实际配的是组合键，按单键不会进录音态，这时需要换这个再试一次。
        'fallbackHotkey': '',
        'leadMs': 250,
        'tailMs': 350,
        'settleMs': 900,
    }
    recorded = str(base.get('RecordingHotkey') or '').strip().lower().replace(' ', '')
    if recorded:
        merged['fallbackHotkey'] = recorded
    # 兼容旧开关：voice-send.json 里 voiceReplyViaExe=true 时走 exe
    legacy = base.get('voiceReplyViaExe')
    if isinstance(legacy, bool):
        merged['enabled'] = not legacy
    for key in ('device', 'hotkey'):
        if isinstance(cfg.get(key), str) and cfg.get(key).strip() != '':
            merged[key] = cfg[key].strip()
    if isinstance(cfg.get('fallbackHotkey'), str):
        merged['fallbackHotkey'] = cfg['fallbackHotkey'].strip().lower().replace(' ', '')
    for key in ('leadMs', 'tailMs', 'settleMs'):
        try:
            merged[key] = max(0, int(cfg.get(key, merged[key])))
        except (TypeError, ValueError):
            pass
    if isinstance(cfg.get('enabled'), bool):
        merged['enabled'] = cfg['enabled']
    return merged


def enabled(root=None):
    return bool(settings(root)['enabled'])


def _log(log, message):
    try:
        if log:
            log(message)
    except Exception:
        pass


# ---------------------------------------------------------------- 播放设备
class WAVEOUTCAPSW(ctypes.Structure):
    _fields_ = [
        ('wMid', ctypes.c_ushort),
        ('wPid', ctypes.c_ushort),
        ('vDriverVersion', ctypes.c_uint32),
        ('szPname', ctypes.c_wchar * 32),
        ('dwFormats', ctypes.c_uint32),
        ('wChannels', ctypes.c_ushort),
        ('wReserved1', ctypes.c_ushort),
        ('dwSupport', ctypes.c_uint32),
    ]


class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [
        ('wFormatTag', ctypes.c_ushort),
        ('nChannels', ctypes.c_ushort),
        ('nSamplesPerSec', ctypes.c_uint32),
        ('nAvgBytesPerSec', ctypes.c_uint32),
        ('nBlockAlign', ctypes.c_ushort),
        ('wBitsPerSample', ctypes.c_ushort),
        ('cbSize', ctypes.c_ushort),
    ]


class WAVEHDR(ctypes.Structure):
    _fields_ = [
        ('lpData', ctypes.c_void_p),
        ('dwBufferLength', ctypes.c_uint32),
        ('dwBytesRecorded', ctypes.c_uint32),
        ('dwUser', ctypes.c_size_t),
        ('dwFlags', ctypes.c_uint32),
        ('dwLoops', ctypes.c_uint32),
        ('lpNext', ctypes.c_void_p),
        ('reserved', ctypes.c_size_t),
    ]


WHDR_DONE = 0x00000001


def _winmm():
    mm = ctypes.WinDLL('winmm')
    mm.waveOutGetNumDevs.restype = ctypes.c_uint
    mm.waveOutGetDevCapsW.argtypes = [ctypes.c_size_t, ctypes.POINTER(WAVEOUTCAPSW), ctypes.c_uint]
    mm.waveOutGetDevCapsW.restype = ctypes.c_uint
    mm.waveOutOpen.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_size_t,
                               ctypes.POINTER(WAVEFORMATEX), ctypes.c_size_t,
                               ctypes.c_size_t, ctypes.c_uint]
    mm.waveOutOpen.restype = ctypes.c_uint
    mm.waveOutPrepareHeader.argtypes = [ctypes.c_void_p, ctypes.POINTER(WAVEHDR), ctypes.c_uint]
    mm.waveOutPrepareHeader.restype = ctypes.c_uint
    mm.waveOutWrite.argtypes = [ctypes.c_void_p, ctypes.POINTER(WAVEHDR), ctypes.c_uint]
    mm.waveOutWrite.restype = ctypes.c_uint
    mm.waveOutUnprepareHeader.argtypes = [ctypes.c_void_p, ctypes.POINTER(WAVEHDR), ctypes.c_uint]
    mm.waveOutUnprepareHeader.restype = ctypes.c_uint
    mm.waveOutClose.argtypes = [ctypes.c_void_p]
    mm.waveOutClose.restype = ctypes.c_uint
    mm.waveOutReset.argtypes = [ctypes.c_void_p]
    mm.waveOutReset.restype = ctypes.c_uint
    return mm


def devices():
    mm = _winmm()
    out = []
    for i in range(int(mm.waveOutGetNumDevs())):
        caps = WAVEOUTCAPSW()
        if mm.waveOutGetDevCapsW(i, ctypes.byref(caps), ctypes.sizeof(caps)) == 0:
            out.append((i, caps.szPname))
    return out


def device_index(name):
    """按名字（不区分大小写、允许是前缀片段）找 waveOut 设备索引；找不到返回 -1。"""
    want = str(name or '').strip().lower()
    if want == '':
        want = DEFAULT_DEVICE_FALLBACK.lower()
    items = devices()
    for index, pname in items:
        if pname.strip().lower() == want:
            return index
    for index, pname in items:
        if want in pname.lower() or pname.lower() in want:
            return index
    return -1


def play_wav(device_name, wav_path, log=None, timeout=180.0):
    """把 WAV 播到指定 waveOut 设备（阻塞到播完）。失败抛 RuntimeError。"""
    index = device_index(device_name)
    with wave.open(wav_path, 'rb') as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    if not frames:
        raise RuntimeError('WAV 是空的')
    fmt = WAVEFORMATEX(1, channels, rate, rate * channels * width, channels * width, width * 8, 0)
    mm = _winmm()
    handle_out = ctypes.c_void_p()
    rc = mm.waveOutOpen(ctypes.byref(handle_out), index if index >= 0 else 0xFFFFFFFF,
                        ctypes.byref(fmt), 0, 0, 0)
    if rc != 0:
        raise RuntimeError('waveOutOpen rc=%d（设备=%s）' % (rc, device_name))
    try:
        buf = ctypes.create_string_buffer(frames, len(frames))
        hdr = WAVEHDR()
        hdr.lpData = ctypes.cast(buf, ctypes.c_void_p)
        hdr.dwBufferLength = len(frames)
        rc = mm.waveOutPrepareHeader(handle_out, ctypes.byref(hdr), ctypes.sizeof(hdr))
        if rc != 0:
            raise RuntimeError('waveOutPrepareHeader rc=%d' % rc)
        rc = mm.waveOutWrite(handle_out, ctypes.byref(hdr), ctypes.sizeof(hdr))
        if rc != 0:
            raise RuntimeError('waveOutWrite rc=%d' % rc)
        deadline = time.time() + timeout
        while not (hdr.dwFlags & WHDR_DONE):
            if time.time() > deadline:
                break
            time.sleep(0.02)
    finally:
        try:
            mm.waveOutReset(handle_out)
        except Exception:
            pass
        try:
            mm.waveOutClose(handle_out)
        except Exception:
            pass
    _log(log, 'V-1b 播放完成：%s → %s' % (os.path.basename(wav_path), device_name))


# ---------------------------------------------------------------- 音频转换
def to_wav(root, audio, log=None):
    """mp3/其它格式 → 44.1kHz/16bit/立体声 WAV，返回路径。"""
    ffmpeg = ffmpeg_runtime.find_ffmpeg(root) or ffmpeg_runtime.configure_ffmpeg(root)
    if not ffmpeg:
        raise RuntimeError('找不到 ffmpeg')
    tmp_dir = os.path.join(root, 'data', 'voice-local', 'tmp')
    os.makedirs(tmp_dir, exist_ok=True)
    stamp = time.strftime('%H%M%S') + ('%03d' % (int(time.time() * 1000) % 1000))
    src = os.path.join(tmp_dir, 'in-%s.mp3' % stamp)
    dst = os.path.join(tmp_dir, 'out-%s.wav' % stamp)
    with open(src, 'wb') as handle:
        handle.write(audio)
    cmd = [ffmpeg, '-y', '-loglevel', 'error', '-i', src,
           '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', dst]
    proc = subprocess.run(cmd, capture_output=True, creationflags=0x08000000)
    try:
        os.remove(src)
    except OSError:
        pass
    if proc.returncode != 0 or not os.path.isfile(dst):
        detail = (proc.stderr or b'').decode('utf-8', 'ignore').strip().splitlines()
        raise RuntimeError('ffmpeg 转换失败：%s' % (detail[-1] if detail else proc.returncode))
    _log(log, 'V-1b 已转 WAV：%s' % os.path.basename(dst))
    return dst


# ---------------------------------------------------------------- 按键
def _key(vk, scan, extended, down):
    user32 = ctypes.WinDLL('user32')
    flags = (0x0001 if extended else 0) | (0 if down else 0x0002)
    user32.keybd_event(vk, scan, flags, 0)


def hotkey_vk(name):
    key = str(name or '').strip().lower().replace(' ', '')
    if key in _HOTKEYS:
        return _HOTKEYS[key]
    if key in COMBO_KEYS:
        return COMBO_KEYS[key]
    if key.startswith('vk'):
        key = key[2:]
    try:
        value = int(key, 10)
    except (TypeError, ValueError):
        value = VK_ALT
    return (value, value in (0xA2, 0xA3, 0xA5))


def hotkey_keys(name):
    """'ctrl+alt' / 'rightalt' → [(vk, scan, extended), ...]，按按下顺序返回。"""
    raw = str(name or '').strip().lower().replace(' ', '')
    if raw == '':
        raw = 'rightalt'
    keys = []
    for part in [p for p in raw.split('+') if p]:
        vk, extended = hotkey_vk(part)
        scan = 0x38 if vk in (0x12, 0xA4, 0xA5) else 0
        keys.append((vk, scan, bool(extended)))
    return keys or [(VK_ALT, 0x38, True)]


def mic_last_used():
    """[WHALE-VOICE-RECORD-CHECK] 读微信最近一次「开始用麦克风」的时间戳。

    Windows 在隐私记录里给每个非打包应用记 LastUsedTimeStart/Stop。微信真进了录音态
    就会刷新它；按热键压下去却没录音时这里不会变。写完语音后比对前后值，就能确定
    「热键到底有没有让微信开始录音」，不用靠微信数据库回读，也不会有重复发语音的副作用。
    读不到（系统没记 / 没有 winreg）返回 None，调用方按未知处理、保持原流程。
    """
    try:
        import winreg
    except Exception:  # noqa: BLE001
        return None
    base = r'SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
    stamps = []
    for sub in (base + r'\NonPackaged', base + r'\Packaged'):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, sub) as parent:
                index = 0
                while True:
                    try:
                        name = winreg.EnumKey(parent, index)
                    except OSError:
                        break
                    index += 1
                    low = name.lower()
                    if 'weixin' not in low and 'wechat' not in low:
                        continue
                    try:
                        with winreg.OpenKey(parent, name) as app:
                            for value_name in ('LastUsedTimeStart', 'LastUsedTimeStop'):
                                try:
                                    value = winreg.QueryValueEx(app, value_name)[0]
                                except OSError:
                                    continue
                                try:
                                    stamps.append(int(value))
                                except (TypeError, ValueError):
                                    continue
                    except OSError:
                        continue
        except OSError:
            continue
    if not stamps:
        return None
    return max(stamps)


def _ensure_foreground(hwnd, log=None):
    """[WHALE-VOICE-FOREGROUND] 把微信拉到前台并校验。

    发语音靠「按住热键让微信录音」，热键只对前台窗口生效：微信在后台时按键落到
    别的窗口，录音不会开始，但 WAV 照样播完，旧流程就误报「V-1b 已发出语音」。
    所以这里必须真的把微信弄到前台，拉不动就返回 False 让上层如实判失败。
    """
    try:
        import win32gui
    except Exception:  # noqa: BLE001 - 没有 pywin32 时保持原行为
        return True
    try:
        win = int(hwnd or 0)
    except (TypeError, ValueError):
        return True
    if win <= 0 or not win32gui.IsWindow(win):
        return True
    try:
        if win32gui.GetForegroundWindow() == win:
            return True
    except Exception:  # noqa: BLE001
        pass
    user32 = ctypes.windll.user32
    try:
        if win32gui.IsIconic(win):
            user32.ShowWindowAsync(win, 9)
        elif not win32gui.IsWindowVisible(win):
            user32.ShowWindowAsync(win, 4)
    except Exception:  # noqa: BLE001
        pass
    for attempt in range(5):
        try:
            # 轻敲 ALT 解开前台锁（系统限制不允许随便抢焦点）
            user32.keybd_event(0x12, 0x38, 0, 0)
            user32.keybd_event(0x12, 0x38, 2, 0)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.04)
        try:
            win32gui.SetForegroundWindow(win)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.12)
        try:
            if win32gui.GetForegroundWindow() == win:
                _log(log, 'V-1b 微信已置前台（第 %d 次尝试）' % (attempt + 1))
                return True
        except Exception:  # noqa: BLE001
            pass
        try:
            user32.SwitchToThisWindow(win, True)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.1)
    _log(log, 'V-1b 微信没能置到前台：按住热键不会进录音态，本轮不假装发送成功')
    return False


# ---------------------------------------------------------------- 合成（无音频时的兜底）
def synthesize(root, text, log=None):
    """没有 dsh 音频时，走本机 QQ 同一条语音代理合成 mp3（音色一致）。"""
    text = str(text or '').strip()
    if text == '':
        return b''
    cfg = _read_json(os.path.join(root, 'data', 'tts-relay.json'))
    upstream = str(cfg.get('upstream') or 'http://127.0.0.1:17890/v1').strip()
    if re.search(r'/(audio/speech|tts|v1/tts)$', upstream):
        url = upstream
    else:
        url = upstream.rstrip('/') + '/audio/speech'
    body = json.dumps({'model': 'tts', 'input': text, 'voice': 'natural',
                       'response_format': 'mp3'}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header('content-type', 'application/json')
    req.add_header('authorization', 'Bearer local')
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
    except (urllib.error.URLError, OSError, ValueError) as exc:
        _log(log, 'V-1b 兜底合成失败：%r' % (exc,))
        return b''
    if not data or len(data) < 256:
        _log(log, 'V-1b 兜底合成返回空')
        return b''
    _log(log, 'V-1b 兜底合成完成 %d 字节' % len(data))
    return data


# ---------------------------------------------------------------- 主流程
def deliver(root, text, audio, hwnd, prepare, log, cancelled=None,
            outcome=None, send_lock=None, foreground=None):
    """走本地录音发送；成功返回 True。失败返回 False 并写 outcome['Error']。"""
    state = {'reason': 'local:no-record'}

    def fail(reason):
        state['reason'] = reason
        if outcome is not None:
            outcome.update(Status='failed', Error=reason)
        _log(log, 'V-1b 失败：%s' % reason)
        return False

    if not audio:
        audio = synthesize(root, text, log)
    if not audio:
        return fail('local:no-audio')
    cfg = settings(root)
    device = cfg['device'] or ''
    candidates = [hotkey_keys(cfg['hotkey'])]
    backup_name = str(cfg.get('fallbackHotkey') or '').strip()
    if backup_name:
        backup = hotkey_keys(backup_name)
        if backup != candidates[0]:
            candidates.append(backup)

    def press_down(seq):
        for vk, scan, extended in seq:
            _key(vk, scan, extended, True)
            time.sleep(0.03)

    def press_up(seq):
        for vk, scan, extended in reversed(seq):
            _key(vk, scan, extended, False)
            time.sleep(0.02)
    if cancelled is not None and cancelled():
        return fail('已取消')
    try:
        wav = to_wav(root, audio, log)
    except Exception as exc:
        return fail('local:wav:%s' % exc)

    # [WHALE-VOICE-DEVCAP] 发语音前把系统默认录音（含通讯角色）临时切到虚拟线 CABLE Output：
    # 微信按住热键录音时是从「默认录音设备」采集的，默认设备是耳机麦时录到的是静音
    # （现场 voicelength 5120ms / length 3341B ≈ 652B/s，对方听不到）。护栏放在 try 外面，
    # 这样 finally 里能拿到 guard 句柄；任何异常都只打日志，不影响发语音本身。
    guard = None
    try:
        import voice_guard as _voice_guard
        guard = _voice_guard.begin(root, log)
    except Exception as exc:  # noqa: BLE001 - 守卫不可用时保持原行为，绝不阻断发送
        _log(log, '[voice-guard] 默认录音守卫不可用（%s），沿用当前默认录音设备'
             % type(exc).__name__)

    def run(seq):
        if cancelled is not None and cancelled():
            return fail('已取消')
        chat = prepare()
        if not chat:
            return fail('local:no-chat')
        # [WHALE-VOICE-FOREGROUND] 热键录音只对前台微信生效，必须先确认真的在前台。
        fg_ok = False
        if foreground is not None:
            try:
                fg_ok = bool(foreground(hwnd))
            except Exception:  # noqa: BLE001
                fg_ok = False
        if not fg_ok:
            fg_ok = _ensure_foreground(hwnd, log)
        if not fg_ok:
            return fail('local:no-foreground')
        mic_before = mic_last_used()
        time.sleep(max(0, cfg['leadMs']) / 1000.0)
        press_down(seq)
        try:
            time.sleep(max(0, cfg['leadMs']) / 1000.0)
            play_wav(device, wav, log)
            time.sleep(max(0, cfg['tailMs']) / 1000.0)
        finally:
            press_up(seq)
        time.sleep(max(0, cfg['settleMs']) / 1000.0)
        # [WHALE-VOICE-RECORD-CHECK] 麦克风使用记录没变 = 微信压根没进录音态，
        # 这时群里不会有语音，不能再写「已发出」。
        mic_after = mic_last_used()
        if mic_before is not None and mic_after is not None and mic_after == mic_before:
            state['reason'] = 'local:no-record'
            _log(log, 'V-1b 微信没有进入录音（麦克风使用记录未刷新），本次热键没生效')
            return False
        if outcome is not None:
            outcome.update(Status='sent', Error='', Chat=chat, Device=device)
        _log(log, 'V-1b 已发出语音（设备=%s，会话=%s）' % (device, chat))
        return True

    def run_with_fallback():
        for index, seq in enumerate(candidates):
            if run(seq):
                return True
            if state['reason'] != 'local:no-record':
                return fail(state['reason'])
            if index + 1 < len(candidates):
                _log(log, 'V-1b 换备用热键 %r 再试一次' % cfg.get('fallbackHotkey'))
                continue
            return fail('local:no-record')
        return fail('local:no-record')

    try:
        if send_lock is not None:
            with send_lock:
                return run_with_fallback()
        return run_with_fallback()
    except Exception as exc:
        try:
            for seq in candidates:
                press_up(seq)
        except Exception:  # noqa: BLE001
            pass
        return fail('local:%s' % type(exc).__name__)
    finally:
        # [WHALE-VOICE-DEVCAP] 发送完成或失败都立刻把默认录音还原成用户原来的设备，
        # 不留副作用（用户自己的通话 / 会议还在用耳机麦）。
        try:
            if guard is not None:
                guard.restore()
        except Exception:  # noqa: BLE001 - 还原失败也不能影响发语音结果
            pass
        try:
            time.sleep(0.5)
            os.remove(wav)
        except OSError:
            pass
