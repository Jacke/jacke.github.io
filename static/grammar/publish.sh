WEBSITE=/Users/stan/Dev/_Me/iamjacke.com/static/grammar
mkdir -p $WEBSITE
cp -r * $WEBSITE
mv $WEBSITE/build.html $WEBSITE/index.html
