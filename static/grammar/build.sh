#!/bin/bash
# Grammar page builder
rm build.md
touch build.md
# Construct page
echo " " >> build.md
SAVEIFS=$IFS
IFS=$'\n'
dirs=$(ls ./content/ | sort -t / -u -z)
#find ./content/ -type d -maxdepth 1 -print0 -execdir rename 's/ /_/g' "{}" + | sort -zV | while read -d $'\0' contentFolder
find ./content/ -type d -maxdepth 1 -print0 | sort -zV | while read -d $'\0' contentFolder
do
    CURRENT_DIR=$(echo $contentFolder | cut -c12-90)
    DIR_TITLE=$(echo $CURRENT_DIR | sed s/_/\ \/g)
    if [ ! -z $DIR_TITLE ]; then
        echo " " >> build.md
        echo '::: {.topic}' >> build.md
        echo "## $DIR_TITLE {.dir_title}" >> build.md
        echo '::: {.resources}' >> build.md
	# Fetch links and push them like this \/
        echo '[Duck Duck Go](https://duckduckgo.com)' >> build.md
        echo '[Duck Duck Go](https://duckduckgo.com)' >> build.md
	echo ':::' >> build.md
        #for file in $(ls -1 ./content/$CURRENT_DIR/*.png |  sed s/\\.\\/content\\/$CURRENT_DIR//g | sort --numeric-sort)
        find ./content/$CURRENT_DIR -name "*.png" -type f -maxdepth 1 -print0 | sort -zV | while read -d $'\0' file
        do #echo "![$file](./$file)" >> build.md /
            CURRENT_FILE=$(echo $file | sed s/\\.\\/content\\/$CURRENT_DIR\\///g)
            echo "![./content/$CURRENT_DIR/$CURRENT_FILE](./content/$CURRENT_DIR/$CURRENT_FILE)" >> build.md;
        done
        echo ':::' >> build.md
    fi
done
IFS=$SAVEIFS
# TOC
doctoc build.md
# Convert page
sed -i '' 's/ {\.dir_title}]/]/g' build.md
sed -i '' 's/^.*Table of Contents.*$//g' build.md
pandoc --metadata title="Grammar" -s build.md -c pandoc.css -H scripts.html -o build.html
sed -i '' 's/<ul>/<ul id="navbar">/g' build.html
sed -i '' 's/<a href=\"#[[:digit:]]*-/<a href="#/g' build.html
sed -i '' 's/-dir_title//' build.html
echo 'Page has been built'
