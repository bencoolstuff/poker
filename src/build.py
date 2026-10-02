"""Builds ../index.html (the full app) from the source files in this folder.
Run:  python3 src/build.py   (from the repo root)"""
import os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda f: open(os.path.join(here, f), encoding='utf-8').read()
t = rd('template.html')
t = (t.replace('/*EQDATA*/', rd('eqdata.json'))
      .replace('/*ENGINE*/', rd('engine.js'))
      .replace('/*POSTFLOP*/', rd('postflop.js'))
      .replace('/*APP*/', rd('app.js')))
page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="description" content="TRex\'s Tournament Trainer - ICM, ranges, drills and table prep for tournament poker.">\n'
        '<style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
        '</head>\n<body>\n' + t + '\n</body>\n</html>\n')
open(os.path.join(here, '..', 'index.html'), 'w', encoding='utf-8').write(page)
print('Built index.html', len(page)//1024, 'KB')
