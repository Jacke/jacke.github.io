#!/bin/zsh

ROOT=$(dirname $(cd "$(dirname "$BASH_SOURCE")"; pwd))/../
echo $ROOT

rm $ROOT/content/content/toolbelt.md
# Fetch toolbelt page to $ROOT/content/content/toolbelt.md
export NOTION_TOKEN=52edf3dad3ecd087fec7b262612e5ad8fc0d2df6672019fe12be540d500b4e28a8cb19ace587cc7df73684b84a8f628bfbc0d3852660912dd129926af5bb0548c6ed8192d4e269be5445964f299c	
# notion fetch ...
notion-exporter a5bfca8f04cb44d0949bc615be8849de -t md > toolbelt.md
# Add front matter
echo "---" >> $ROOT/content/content/toolbelt.md
echo "title: \"Toolbelt\"" >> $ROOT/content/content/toolbelt.md
echo "date: 2022-08-07T21:59:46+03:00" >> $ROOT/content/content/toolbelt.md
echo "draft: false" >> $ROOT/content/content/toolbelt.md
echo "disableAnchoredHeadings: false" >> $ROOT/content/content/toolbelt.md
echo "hideMeta: true" >> $ROOT/content/content/toolbelt.md
echo "ShowToc: true" >> $ROOT/content/content/toolbelt.md
echo "hideSummary: true" >> $ROOT/content/content/toolbelt.md
echo "showBreadCrumbs: true" >> $ROOT/content/content/toolbelt.md
echo "description: \"Best tools you can use in various activities\"" >> $ROOT/content/content/toolbelt.md
echo "---" >> $ROOT/content/content/toolbelt.md
cat toolbelt.md | sed "s/# Toolbelt//g" >> $ROOT/content/content/toolbelt.md
# Add TOC
echo 'Toolbelt page has been generated'
