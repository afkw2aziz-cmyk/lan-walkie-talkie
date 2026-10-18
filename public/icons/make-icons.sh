#!/usr/bin/env bash
# توليد أيقونات التطبيق بـ ffmpeg (بدون أي اعتماد خارجي)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

BASE=0x0b1220; GREEN=0x27d17c; GREEN2=0x12a862; GREY=0x8fa2c4; PANEL=0x0e1730

GLYPH="\
drawbox=x=0:y=0:w=512:h=512:color=$BASE:t=fill,\
drawbox=x=196:y=52:w=22:h=130:color=$GREY:t=fill,\
drawbox=x=138:y=168:w=236:h=296:color=$GREEN:t=fill,\
drawbox=x=138:y=168:w=236:h=26:color=$GREEN2:t=fill,\
drawbox=x=170:y=214:w=172:h=96:color=$BASE:t=fill,\
drawbox=x=186:y=236:w=140:h=10:color=$GREY:t=fill,\
drawbox=x=186:y=262:w=140:h=10:color=$GREY:t=fill,\
drawbox=x=186:y=288:w=140:h=10:color=$GREY:t=fill,\
drawbox=x=386:y=300:w=34:h=96:color=$GREEN2:t=fill,\
drawbox=x=176:y=350:w=160:h=90:color=$PANEL:t=fill,\
drawbox=x=196:y=372:w=120:h=14:color=$GREEN:t=fill,\
drawbox=x=196:y=400:w=120:h=14:color=$GREEN:t=fill"

# maskable: الخلفية ممتلئة والرسم مُصغَّر داخل المنطقة الآمنة (80%)
MASKABLE="\
drawbox=x=0:y=0:w=512:h=512:color=$BASE:t=fill,\
drawbox=x=212:y=87:w=18:h=104:color=$GREY:t=fill,\
drawbox=x=166:y=180:w=180:h=236:color=$GREEN:t=fill,\
drawbox=x=166:y=180:w=180:h=21:color=$GREEN2:t=fill,\
drawbox=x=190:y=217:w=132:h=77:color=$BASE:t=fill,\
drawbox=x=203:y=235:w=106:h=8:color=$GREY:t=fill,\
drawbox=x=203:y=256:w=106:h=8:color=$GREY:t=fill,\
drawbox=x=203:y=277:w=106:h=8:color=$GREY:t=fill,\
drawbox=x=356:y=286:w=26:h=77:color=$GREEN2:t=fill,\
drawbox=x=196:y=326:w=120:h=72:color=$PANEL:t=fill,\
drawbox=x=211:y=344:w=90:h=11:color=$GREEN:t=fill,\
drawbox=x=211:y=366:w=90:h=11:color=$GREEN:t=fill"

mk() { # mk <filter> <size> <out>
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=$BASE:s=512x512:d=1" \
    -vf "$1,scale=$2:$2:flags=lanczos" -frames:v 1 "$3"
}

mk "$GLYPH"    512 icon-512.png
mk "$GLYPH"    192 icon-192.png
mk "$GLYPH"    180 icon-180.png
mk "$MASKABLE" 512 icon-maskable-512.png

ls -l *.png
file icon-512.png
