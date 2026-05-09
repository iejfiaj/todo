#!/bin/bash
# 더블클릭하면 로컬 서버를 띄우고 Chrome 앱 창으로 To-do 앱을 엽니다.

cd "$(dirname "$0")"

PORT=9876
URL="http://localhost:$PORT/index.html"

# 같은 포트에 이미 서버가 떠 있으면 다시 띄우지 않음
if ! lsof -i :$PORT >/dev/null 2>&1; then
  nohup python3 -m http.server $PORT >/tmp/todomaster-server.log 2>&1 &
  # 서버가 받을 준비 될 때까지 잠깐 대기
  for i in {1..20}; do
    if lsof -i :$PORT >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
fi

# Chrome 앱 모드 (주소창/탭 없는 전용 창)
open -na "Google Chrome" --args --app="$URL"
