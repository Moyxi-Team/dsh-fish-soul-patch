# -*- coding: utf-8 -*-
# [WHALE-VOICE-DEVCAP] 语音发送前的「默认录音设备守卫」+ 发送后码率校验。
#
# 现场问题：V-1b 本地录音链路是「WAV 播进 CABLE Input（虚拟线）→ 微信按住热键录音，
# 从系统默认录音设备采集」。只要默认录音是真实麦克风（耳机麦 / 板载麦），微信录到的
# 就是静音：语音正常发出，但对方听到的是空的（日志 voicelength 5120ms / length 3341B
# ≈ 652 B/s；正常语音在 2KB/s 以上）。
#
# 方案 B：发语音前把默认录音设备的 console / multimedia / communications 三个角色临时
# 切到 CABLE Output，发送完成或失败后立刻还原原设备；发完回读微信库，用
# length / (voicelength/1000) 算码率，低于 minBitrate（默认 900 B/s）判为空语音，
# 交由上层重试一次或降级。
#
# 本文件由 dsh-fish-soul-patch 的 W17 规则整份落盘（assets/whalegirl/voice_guard.py），
# 鲸鱼更新把 bridge/ 换回官方版后跑一次补丁即可复原。只依赖 ctypes 直连 CoreAudio，
# 不引入新依赖；任何一步失败都只打日志，绝不让语音流程本身报错。
import json
import os
import re
import time

"""原型：用 ctypes 直连 CoreAudio 读写「默认音频端点」。

- list_endpoints(dataflow) -> [(id, friendly_name)]
- get_default(dataflow, role) -> id
- set_default(id, role) -> hr
只做实验，确认 vtable 索引与结构布局正确。
"""
import ctypes
from ctypes import POINTER, byref, c_void_p, c_uint32, c_uint16, c_ubyte, c_wchar_p, c_ushort
from ctypes import wintypes

ole32 = ctypes.WinDLL('ole32')
ole32.CoInitializeEx.argtypes = [c_void_p, c_uint32]
ole32.CoInitializeEx.restype = ctypes.c_long
ole32.CoCreateInstance.argtypes = [c_void_p, c_void_p, c_uint32, c_void_p, POINTER(c_void_p)]
ole32.CoCreateInstance.restype = ctypes.c_long
ole32.CoTaskMemFree.argtypes = [c_void_p]


class GUID(ctypes.Structure):
    _fields_ = [('Data1', c_uint32), ('Data2', c_uint16), ('Data3', c_uint16),
                ('Data4', c_ubyte * 8)]

    def __init__(self, text=''):
        super().__init__()
        if text:
            self.load(text)

    def load(self, text):
        body = text.strip().strip('{}')
        parts = body.split('-')
        self.Data1 = int(parts[0], 16)
        self.Data2 = int(parts[1], 16)
        self.Data3 = int(parts[2], 16)
        tail = parts[3] + parts[4]
        for i in range(8):
            self.Data4[i] = int(tail[i * 2:i * 2 + 2], 16)


CLSID_MMDeviceEnumerator = GUID('{BCDE0395-E52F-467C-8E3D-C4579291692E}')
IID_IMMDeviceEnumerator = GUID('{A95664D2-9614-4F35-A746-DE8DB63617E6}')
CLSID_PolicyConfigClient = GUID('{870AF99C-171D-4F9E-AF0D-E63DF40C2BC9}')
IID_IPolicyConfig = GUID('{F8679F50-850A-41CF-9C72-430F290290C8}')
IID_IPropertyStore = GUID('{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}')

PKEY_Device_FriendlyName = (GUID('{a45c254e-df1c-4efd-8020-67d146a850e0}'), 14)


class PROPERTYKEY(ctypes.Structure):
    _fields_ = [('fmtid', GUID), ('pid', c_uint32)]


def pkey(guid, pid):
    return PROPERTYKEY(guid, pid)


CLSCTX_ALL = 0x17
COINIT_APARTMENTTHREADED = 0x2


def _vt(ptr, index, restype, argtypes):
    """取出接口指针 ptr 的第 index 个虚函数，包装成可调用的函数对象。"""
    vtbl = ctypes.cast(ptr, POINTER(c_void_p))[0]
    fn = ctypes.cast(vtbl, POINTER(c_void_p))[index]
    return ctypes.WINFUNCTYPE(restype, *argtypes)(fn)


def create(clsid, iid):
    ptr = c_void_p()
    hr = ole32.CoCreateInstance(byref(clsid), None, CLSCTX_ALL, byref(iid), byref(ptr))
    if hr != 0:
        raise OSError('CoCreateInstance hr=0x%08x' % (hr & 0xffffffff))
    return ptr


def _release(ptr):
    try:
        _vt(ptr, 2, ctypes.c_ulong, [c_void_p])(ptr)
    except Exception:
        pass


def _device_name(dev):
    store = c_void_p()
    hr = _vt(dev, 4, ctypes.c_long, [c_void_p, c_uint32, POINTER(c_void_p)])(dev, 0, byref(store))
    if hr != 0:
        return ''
    try:
        buf = (ctypes.c_byte * 24)()
        hr = _vt(store, 5, ctypes.c_long, [c_void_p, POINTER(PROPERTYKEY), ctypes.c_void_p])(
            store, byref(pkey(*PKEY_Device_FriendlyName)), ctypes.cast(buf, ctypes.c_void_p))
        if hr != 0:
            return ''
        vt = ctypes.cast(buf, POINTER(c_ushort)).contents.value
        if vt != 31:  # VT_LPWSTR
            return ''
        raw = ctypes.cast(byref(buf, 8), POINTER(c_void_p)).contents.value
        if not raw:
            return ''
        return ctypes.wstring_at(raw)
    finally:
        _release(store)


def _device_id(dev):
    out = c_void_p()
    hr = _vt(dev, 5, ctypes.c_long, [c_void_p, POINTER(c_void_p)])(dev, byref(out))
    if hr != 0 or not out.value:
        return ''
    try:
        return ctypes.wstring_at(out.value)
    finally:
        ole32.CoTaskMemFree(out)


def list_endpoints(dataflow=1, state=1):
    en = create(CLSID_MMDeviceEnumerator, IID_IMMDeviceEnumerator)
    try:
        coll = c_void_p()
        hr = _vt(en, 3, ctypes.c_long, [c_void_p, c_uint32, c_uint32, POINTER(c_void_p)])(
            en, dataflow, state, byref(coll))
        if hr != 0:
            raise OSError('EnumAudioEndpoints hr=0x%08x' % (hr & 0xffffffff))
        try:
            count = c_uint32()
            _vt(coll, 3, ctypes.c_long, [c_void_p, POINTER(c_uint32)])(coll, byref(count))
            out = []
            for i in range(count.value):
                dev = c_void_p()
                if _vt(coll, 4, ctypes.c_long, [c_void_p, c_uint32, POINTER(c_void_p)])(coll, i, byref(dev)) != 0:
                    continue
                try:
                    out.append((_device_id(dev), _device_name(dev)))
                finally:
                    _release(dev)
            return out
        finally:
            _release(coll)
    finally:
        _release(en)


def get_default(dataflow=1, role=1):
    en = create(CLSID_MMDeviceEnumerator, IID_IMMDeviceEnumerator)
    try:
        dev = c_void_p()
        hr = _vt(en, 4, ctypes.c_long, [c_void_p, c_uint32, c_uint32, POINTER(c_void_p)])(
            en, dataflow, role, byref(dev))
        if hr != 0:
            return ''
        try:
            return _device_id(dev)
        finally:
            _release(dev)
    finally:
        _release(en)


def get_default_name(dataflow=1, role=1):
    en = create(CLSID_MMDeviceEnumerator, IID_IMMDeviceEnumerator)
    try:
        dev = c_void_p()
        hr = _vt(en, 4, ctypes.c_long, [c_void_p, c_uint32, c_uint32, POINTER(c_void_p)])(
            en, dataflow, role, byref(dev))
        if hr != 0:
            return ''
        try:
            return _device_name(dev)
        finally:
            _release(dev)
    finally:
        _release(en)


def set_default(device_id, role=1):
    pc = create(CLSID_PolicyConfigClient, IID_IPolicyConfig)
    try:
        return _vt(pc, 13, ctypes.c_long, [c_void_p, c_wchar_p, c_uint32])(pc, device_id, role)
    finally:
        _release(pc)


# ---------------------------------------------------------------- 设备守卫
RENDER = 0
CAPTURE = 1
_ROLES = (0, 1, 2)                 # console / multimedia / communications
_CAPTURE_PREFIX = 'CABLE Output'
_MIN_BITRATE = 900.0               # 字节/秒，低于这个值判空语音
_WAIT_MS = 6000


def _log(log, message):
    try:
        if log:
            log(message)
    except Exception:
        pass


_CO_READY = [False]


def _co_init():
    """桥进程里可能还没初始化过 COM，先补一次（已在别的模式下初始化过也照常可用）。"""
    if _CO_READY[0]:
        return True
    try:
        ole32.CoInitializeEx(None, COINIT_APARTMENTTHREADED)
    except Exception:  # noqa: BLE001 - RPC_E_CHANGED_MODE 等都不影响取端点
        pass
    _CO_READY[0] = True
    return True


def _cfg(root=None):
    path = os.path.join(str(root or ''), 'data', 'voice-local.json')
    try:
        with open(path, encoding='utf-8-sig') as f:
            value = json.load(f)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _find_capture(prefix):
    _co_init()
    prefix = str(prefix or _CAPTURE_PREFIX).strip().lower()
    try:
        items = list_endpoints(CAPTURE)
    except Exception:
        return '', ''
    for dev_id, name in items:
        if str(name or '').strip().lower().startswith(prefix):
            return dev_id, name
    return '', ''


class _Handle(object):
    def __init__(self, target, name, roles, log=None):
        self.target = target
        self.name = name
        self.roles = roles
        self.log = log
        self.done = False

    def restore(self):
        """把 console/multimedia/communications 三处默认录音还原成发语音之前的值。"""
        if self.done:
            return True
        self.done = True
        ok = True
        for role in _ROLES:
            old = self.roles.get(role) or ''
            if not old or old == self.target:
                continue
            try:
                hr = set_default(old, role)
            except Exception as exc:  # noqa: BLE001 - 还原失败不能影响发语音结果
                ok = False
                _log(self.log, '[voice-guard] 还原默认录音失败 role=%s %s'
                     % (role, type(exc).__name__))
                continue
            if hr != 0:
                ok = False
                _log(self.log, '[voice-guard] 还原默认录音失败 role=%s hr=0x%08x'
                     % (role, hr & 0xffffffff))
        _log(self.log, '[voice-guard] 默认录音已还原到发语音前的设备（%s）'
             % ('ok' if ok else '部分失败，见上一条'))
        return ok


def begin(root=None, log=None):
    """发语音前调用：临时把默认录音切到虚拟线。返回 _Handle（失败返回 None）。"""
    cfg = _cfg(root)
    if cfg.get('deviceGuard') is False:
        _log(log, '[voice-guard] deviceGuard=false，跳过默认录音切换')
        return None
    target, name = _find_capture(cfg.get('captureDevice') or _CAPTURE_PREFIX)
    if not target:
        _log(log, '[voice-guard] 找不到录音设备「%s」，跳过高切（这条语音很可能是空的）'
             % (cfg.get('captureDevice') or _CAPTURE_PREFIX))
        return None
    roles = {}
    for role in _ROLES:
        try:
            roles[role] = get_default(CAPTURE, role) or ''
        except Exception:
            roles[role] = ''
    switched = []
    for role in _ROLES:
        if roles.get(role) == target:
            continue
        try:
            hr = set_default(target, role)
        except Exception as exc:  # noqa: BLE001
            _log(log, '[voice-guard] 切默认录音失败 role=%s %s' % (role, type(exc).__name__))
            continue
        if hr == 0:
            switched.append(role)
        else:
            _log(log, '[voice-guard] 切默认录音失败 role=%s hr=0x%08x' % (role, hr & 0xffffffff))
    handle = _Handle(target, name, roles, log)
    if switched:
        _log(log, '[voice-guard] 默认录音临时切到 %s（role=%s），原设备已记录待还原'
             % (name, switched))
    else:
        _log(log, '[voice-guard] 默认录音本来就在 %s，无需切换' % name)
    return handle


# ---------------------------------------------------------------- 码率校验
_VOICE_RE = re.compile(r'<voicemsg\b([^>]*)>', re.I)


def _attr(attrs, key):
    m = re.search(r'\b%s\s*=\s*"([^"]*)"' % key, attrs, re.I)
    return m.group(1) if m else ''


def parse_bitrate(content):
    """从语音行 content 里算码率：(字节/秒, 字节数, 毫秒)。解析不出返回 None。"""
    m = _VOICE_RE.search(content or '')
    if not m:
        return None
    attrs = m.group(1)
    try:
        length = int(_attr(attrs, 'length') or 0)
        ms = int(_attr(attrs, 'voicelength') or 0)
    except (TypeError, ValueError):
        return None
    if length <= 0 or ms <= 0:
        return None
    return length / (ms / 1000.0), length, ms


def voice_cursor(db, username):
    """记下当前最新一条语音的 (sort_seq, local_id)：local_id 只在分片内唯一，
    wechatauto 的跨分片排序键是 (sort_seq, 分片序, local_id)，这里用 (sort_seq, local_id)
    就足以判断「这一条是不是这次新发的」。"""
    try:
        rows = db.get_messages(username, limit=10) or []
    except Exception:
        return (0, 0)
    best = (0, 0)
    for row in rows:
        row = row or {}
        if str(row.get('type') or '') != '语音':
            continue
        try:
            key = (int(row.get('sort_seq') or 0), int(row.get('local_id') or 0))
        except (TypeError, ValueError):
            continue
        if key > best:
            best = key
    return best


def check_voice(db, username, me, cursor, since_ts, root=None):
    """回读微信库校验刚发的那条语音。

    返回 {'state': 'ok'|'empty'|'unknown', 'bitrate': 字节/秒, 'detail': 说明}
      ok      码率正常，可听
      empty   码率低于阈值，判为空语音（上层按约定重试 / 降级）
      unknown 等不到这次落库的语音行（不做重试，按已发处理，避免重复发）
    """
    cfg = _cfg(root)
    try:
        threshold = float(cfg.get('minBitrate') or 0) or _MIN_BITRATE
    except (TypeError, ValueError):
        threshold = _MIN_BITRATE
    try:
        wait_ms = int(cfg.get('verifyWaitMs') or 0) or _WAIT_MS
    except (TypeError, ValueError):
        wait_ms = _WAIT_MS
    deadline = time.time() + max(0, wait_ms) / 1000.0
    me = str(me or '')
    try:
        cursor_key = (int((cursor or (0, 0))[0]), int((cursor or (0, 0))[1]))
    except (TypeError, ValueError, IndexError):
        cursor_key = (0, 0)
    floor = int(since_ts) - 120 if since_ts else 0
    last = 'no-voice-row'
    while True:
        try:
            rows = db.get_messages(username, limit=10) or []
        except Exception as exc:  # noqa: BLE001
            return {'state': 'unknown', 'detail': 'db:%s' % type(exc).__name__}
        best = None
        for row in rows:
            row = row or {}
            if str(row.get('type') or '') != '语音':
                continue
            sender = str(row.get('sender_username') or '')
            if me and sender and sender != me:
                continue
            try:
                key = (int(row.get('sort_seq') or 0), int(row.get('local_id') or 0))
                ts = int(row.get('create_time') or 0)
            except (TypeError, ValueError):
                continue
            if cursor_key != (0, 0) and key <= cursor_key:
                continue
            if not key[0] and floor and ts and ts < floor:
                continue
            if best is None or key >= best[0]:
                best = (key, row.get('content') or '')
        if best is not None:
            parsed = parse_bitrate(best[1])
            if parsed is None:
                last = 'no-bitrate'
            else:
                bps, length, ms = parsed
                detail = '%.0fB/s（%dB/%.1fs）' % (bps, length, ms / 1000.0)
                return {'state': 'ok' if bps >= threshold else 'empty',
                        'bitrate': bps, 'detail': detail}
        if time.time() >= deadline:
            return {'state': 'unknown', 'detail': last}
        time.sleep(0.4)
