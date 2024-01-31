#!/usr/bin/env bash
###########################
# Stan Sob Jacke@github.com
# iamjacke.com
###########################
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd $SCRIPT_DIR/../../content/changelog/
str=`pwd`
str_esc=$(printf '%s\n' "$str" | sed 's:/:\\&:g')
# Version setter
# echo "s/$str_esc\/content\/changelog\///"
LAST_VER=`fd -a '\d\.\d\.\d' --extension md ./ | sed "s/$str_esc\/v//" | sed "s/\.md//" | tail -n1`
NEW_VER=`echo $LAST_VER | ( IFS=".$IFS" ; read a b c && echo $a.$b.$((c + 1)) )`

# Page creation
touch "v$NEW_VER.md"
echo '---' >> "v$NEW_VER.md"
echo 'title: "v'$NEW_VER $@'"' >> "v$NEW_VER.md"
echo 'date: 2022-08-07T21:59:46+03:00' >> "v$NEW_VER.md"
echo 'draft: true' >> "v$NEW_VER.md"
echo 'disableAnchoredHeadings: true' >> "v$NEW_VER.md"
echo 'hideMeta: true' >> "v$NEW_VER.md"
echo 'tags:' >> "v$NEW_VER.md"
  echo '  - Development' >> "v$NEW_VER.md"
  echo '  - Scala' >> "v$NEW_VER.md"
echo '---' >> "v$NEW_VER.md"
echo '\n' >> "v$NEW_VER.md"
echo 'Lorem ipsum dolor, sit ' >> "v$NEW_VER.md"