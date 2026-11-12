// boot-hooks.mjs — cordis plugin whose only job is "DSH just started, wake the
// local fish-soul service stack". It lives in C:\Users\Administrator\.dsh\boot-hooks
// (outside node_modules) so npm/pnpm plugin updates cannot delete it, and it is
// registered from the profile's own cordis.patch.yml.
//
// It deliberately does nothing else: no services of its own, no timers, no state.
// The heavy lifting stays in app-triggered-boot.ps1 + the two watchdogs, which are
// resident loops that exit on their own once DSH is gone.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

export const name = 'dsh-boot-hooks';
export const inject = [];

const WSCRIPT = 'C:\\Windows\\System32\\wscript.exe';
const LAUNCHER = 'C:\\Users\\Administrator\\.dsh\\app-triggered-boot.vbs';
const MARK = 'C:\\Users\\Administrator\\.dsh\\boot-hooks\\loaded.log';

function mark(line) {
  try { fs.appendFileSync(MARK, new Date().toISOString() + ' ' + line + '\r\n'); } catch {}
}

let fired = false;

export function apply() {
  mark('apply called (fired=' + fired + ')');
  if (fired) return;
  fired = true;
  try {
    const child = spawn(
      WSCRIPT,
      ['//B', '//Nologo', LAUNCHER],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.on('error', (e) => mark('spawn error: ' + (e && e.message)));
    mark('spawned pid ' + child.pid);
    child.unref();
  } catch (e) {
    mark('spawn threw: ' + (e && e.message));
  }
}
