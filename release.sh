version_num = $1
if [ -z "$version_num" ]; then
  echo "Specify a version number"
  read version_num
  if [ -z "$version_num"]; then
    exit
  fi
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
sed -e "s/\#{VERSION}\#/$version_num/g" -I '' release/module.json
cp release/module.json release/module/
cd release
zip -r module.zip module
cd ..
