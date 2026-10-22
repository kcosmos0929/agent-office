// launchd 사용자 에이전트 plist: 로그인 시 서버를 켜고, 꺼지면 다시 켠다.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderPlist(o: { label: string; nodePath: string; mainPath: string; logPath: string; soHome: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(o.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(o.nodePath)}</string>
    <string>${esc(o.mainPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${esc(o.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(o.logPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SO_HOME</key>
    <string>${esc(o.soHome)}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
}
