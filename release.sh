if [ -z "$1" ]; then
  echo "Specify a version number"
  exit
fi
rm -rf release
mkdir release
mkdir release/module
cp module.json release
cp README.md release/module/
cp -r languages release/module/
cp -r scripts release/module/
cp -r styles release/module/
cp -r templates release/module/
sed -e "s/\#{VERSION}\#/$1/g" -I '' release/module.json
cp release/module.json release/module/
cd release
zip -r module.zip module
cd ..
