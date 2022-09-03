#!/bin/zsh

rm $ROOT/content/content/toolbelt.md
# Fetch toolbelt page to $ROOT/content/content/toolbelt.md
# notion fetch ...
# Add front matter
echo "---" >> $ROOT/content/content/toolbelt.md
echo "title: \"Toolbelt\"" >> $ROOT/content/content/toolbelt.md
echo "date: 2022-08-07T21:59:46+03:00" >> $ROOT/content/content/toolbelt.md
echo "draft: false" >> $ROOT/content/content/toolbelt.md
echo "disableAnchoredHeadings: true" >> $ROOT/content/content/toolbelt.md
echo "hideMeta: true" >> $ROOT/content/content/toolbelt.md
echo "hideSummary: true" >> $ROOT/content/content/toolbelt.md
echo "showBreadCrumbs: true" >> $ROOT/content/content/toolbelt.md
echo "description: \"Best tools you can use in various activities\"" >> $ROOT/content/content/toolbelt.md
echo "---" >> $ROOT/content/content/toolbelt.md
# Add TOC
echo 'Toolbelt page has been generated'