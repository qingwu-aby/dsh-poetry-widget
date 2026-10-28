#!/usr/bin/env python3
"""给 profile 里的 dsh-qqbot 加一个本机 proactive 路由（QQ 主动消息）。
升级 dsh-qqbot 后重新运行；会先备份 .proactive-bak。"""
from pathlib import Path
import os, shutil, sys

profile = Path(os.environ.get('DSH_PROFILE_DIR') or (Path.home() / '.dsh/profiles/desktop'))
target = profile / 'node_modules/@tencent-connect/dsh-qqbot/dist/gateway/bootstrap.js'
if not target.exists():
    sys.exit(f'not found: {target}')
s = target.read_text(encoding='utf8')
if '/api/qqbot/proactive' in s:
    print('already patched'); sys.exit(0)
backup = target.with_suffix(target.suffix + '.proactive-bak')
if not backup.exists(): shutil.copy2(target, backup)
s = s.replace("import { QQBot } from '@tencent-connect/qqbot-nodejs';\n", "import { QQBot } from '@tencent-connect/qqbot-nodejs';\nimport { readFileSync } from 'node:fs';\nimport os from 'node:os';\nimport path from 'node:path';\n", 1)
needle = "    const bot = new QQBot({"
if needle not in s: sys.exit('bootstrap pattern changed: bot creation')
s = s.replace(needle, "    let lastC2CPeer = null;\n" + needle, 1)
needle = "        const msg = mCtx.message;\n"
if needle not in s: sys.exit('bootstrap pattern changed: message handler')
s = s.replace(needle, needle + "        if (msg.kind !== 'group') lastC2CPeer = msg.senderId;\n", 1)
needle = "    const outboundHandler = createOutboundHandler(manager, sender, config, logger, toolsRegistry);\n"
if needle not in s: sys.exit('bootstrap pattern changed: sender')
route = '''
    // 小鲸鱼主动消息路由：本机 token 保护，只发给最近一个私聊 peer。
    try {
        const webServer = ctx.get('webServer');
        if (webServer && typeof webServer.register === 'function') {
            const tokenPath = path.join(process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), '.dsh'), '.dsh-poetry', 'qq-proactive-token');
            webServer.register({
                kind: 'exact',
                path: '/api/qqbot/proactive',
                handler: async (req, res) => {
                    const respond = (status, payload) => {
                        const body = JSON.stringify(payload);
                        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) });
                        res.end(body);
                    };
                    if ((req.method || '').toUpperCase() !== 'POST') return respond(405, { ok: false, error: 'method_not_allowed' });
                    let raw = '';
                    try {
                        for await (const chunk of req) raw += chunk;
                    } catch {
                        return respond(400, { ok: false, error: 'bad_body' });
                    }
                    let body = null;
                    try { body = JSON.parse(raw); } catch { return respond(400, { ok: false, error: 'bad_json' }); }
                    let token = '';
                    try { token = readFileSync(tokenPath, 'utf8').trim(); } catch { /* no token */ }
                    if (!token || !body || typeof body.token !== 'string' || body.token !== token) return respond(403, { ok: false, error: 'forbidden' });
                    if (lastC2CPeer === null) return respond(409, { ok: false, error: 'no_peer' });
                    const text = String(body.text ?? '').trim().slice(0, 500);
                    if (!text) return respond(400, { ok: false, error: 'empty' });
                    try {
                        await bot.sendMarkdown({ scope: 'c2c', targetId: lastC2CPeer }, text);
                        return respond(200, { ok: true });
                    } catch (error) {
                        return respond(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
                    }
                },
            });
        }
    } catch {
        /* webServer 尚未就绪时静默降级 */
    }
'''
s = s.replace(needle, route + needle, 1)
target.write_text(s, encoding='utf8')
print('patched', target)
