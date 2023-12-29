# Install dependencies

npm install --save-dev prettier eslint eslint-plugin-prettier eslint-config-prettier prettier-plugin-yaml

# Create .prettierrc

{
"tabWidth": 4,
"overrides": [
{
"files": ["*.yaml", "*.yml"],
"options": {
"parser": "yaml",
"tabWidth": 2
}
}
]
}

# Update .eslintrc.json

{
"extends": [
"plugin:prettier/recommended"
],
"plugins": ["prettier"],
}
