-- Synthetic Office 아이콘 앱: 서버가 켜져 있으면 바로 오피스를 열고, 꺼져 있으면 켠 뒤 연다.
-- {{PORT}}는 설치기가 설정 포트로 바꿔 넣는다.
property baseURL : "http://127.0.0.1:{{PORT}}"

on healthy()
	try
		return (do shell script "curl -s --max-time 1 " & baseURL & "/healthz") is "ok"
	on error
		return false
	end try
end healthy

on run
	if not my healthy() then
		display notification "Synthetic Office를 켜는 중이에요…" with title "Synthetic Office"
		try
			do shell script "launchctl kickstart gui/$(id -u)/com.synthetic-office.server || launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.synthetic-office.server.plist"
		end try
		repeat 30 times
			if my healthy() then exit repeat
			delay 0.5
		end repeat
		if not my healthy() then
			display dialog "Synthetic Office를 켜지 못했어요." & return & "기록: ~/.synthetic-office/server.log" buttons {"확인"} default button "확인" with title "Synthetic Office" with icon caution
			return
		end if
	end if
	open location baseURL
end run
