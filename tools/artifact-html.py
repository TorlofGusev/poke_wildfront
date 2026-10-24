"""Turns dist-single/index.html into the body-only page format of a claude.ai artifact.
Usage: python3 tools/artifact-html.py OUTPUT.html"""
import re
import sys

h = open("dist-single/index.html").read()
head = h[h.index("<head>") + 6 : h.index("</head>")]
body = h[h.index("<body>") + 6 : h.rindex("</body>")]
head = re.sub(r"\s*<meta charset[^>]*>", "", head)
head = re.sub(r'\s*<meta name="viewport"[^>]*>', "", head)
head = head.replace(
    "<title>Pokémon Wildfront</title>",
    '<title>Pokémon Wildfront</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
    "<style>body{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));box-sizing:border-box}</style>",
)
open(sys.argv[1], "w").write(head.strip() + "\n" + body.strip() + "\n")
