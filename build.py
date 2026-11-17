#!/usr/bin/env python3
"""Assemble src/base.html + module fragments into one self-contained page.
usage: python3 build.py [-o OUT] [--skip NAME ...]   (NAME is inventory, ledger, descent or after)"""
import argparse, os, re
ap = argparse.ArgumentParser(); ap.add_argument('-o', default='index.html'); ap.add_argument('--skip', nargs='*', default=[])
a = ap.parse_args(); here = os.path.dirname(os.path.abspath(__file__)); src = os.path.join(here, 'src')
s = open(os.path.join(src, 'base.html'), encoding='utf-8').read()
def frag(name):
    mod = name.split('.')[0].split('_')[0]; p = os.path.join(src, name)
    return open(p, encoding='utf-8').read() if mod not in a.skip and os.path.exists(p) else ''
s = re.sub(r'<!--@([\w.]+)-->', lambda m: frag(m.group(1)), s)
s = re.sub(r'/\*@([\w.]+)\*/', lambda m: frag(m.group(1)), s)
s = re.sub(r'//@([\w.]+)', lambda m: frag(m.group(1)), s)
open(os.path.join(here, a.o), 'w', encoding='utf-8').write(s); print('built', a.o, len(s), 'bytes')
