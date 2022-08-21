#!/bin/bash
# Grammar page builder
rm build.md
touch build.md
# Construct page
echo " " >> build.md
SAVEIFS=$IFS
IFS=$'\n'
SKIP_SECTION=0
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
        # Resources
        echo '::: {.resources}' >> build.md
        if [ -f "$CURRENT_DIR/desc.md" ]; then
            # Fetch links and push them like this \/
            cat "$CURRENT_DIR/desc.md" >> build.md
        fi
        echo ':::' >> build.md
        #for file in $(ls -1 ./content/$CURRENT_DIR/*.png |  sed s/\\.\\/content\\/$CURRENT_DIR//g | sort --numeric-sort)
        CUR_POS=0
        SKIP_SECTION=$((SKIP_SECTION+1))
        find ./content/$CURRENT_DIR -name "*.png" -type f -maxdepth 1 -print0 | sort -zV | while read -d $'\0' file
        do #echo "![$file](./$file)" >> build.md /
            CURRENT_FILE=$(echo $file | sed s/\\.\\/content\\/$CURRENT_DIR\\///g)
            IMAGE_WIDTH=$(identify -format 'width=%wpx' ./content/$CURRENT_DIR/$CURRENT_FILE)
	    IMAGE_HEIGHT=$(identify -format 'height=%hpx' ./content/$CURRENT_DIR/$CURRENT_FILE)

            if [[ $CUR_POS -lt 5 ]] && [[ $SKIP_SECTION -lt 2 ]]; then
              CUR_POS=$((CUR_POS+1))
              echo $IMAGE_HEIGHT
              echo "![./content/$CURRENT_DIR/$CURRENT_FILE](./content/$CURRENT_DIR/$CURRENT_FILE){$IMAGE_WIDTH $IMAGE_HEIGHT}" >> build.md;
            else
              echo "![./content/$CURRENT_DIR/$CURRENT_FILE](./content/$CURRENT_DIR/$CURRENT_FILE){$IMAGE_WIDTH $IMAGE_HEIGHT loading=lazy}" >> build.md;
            fi
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
