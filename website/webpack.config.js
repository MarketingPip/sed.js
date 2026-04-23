const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  // Define your entry points (one for each page)
  const entries = {
    index: path.resolve(__dirname, 'js/main.js'),
   // about: path.resolve(__dirname, 'js/about.js'),
   // contact: path.resolve(__dirname, 'js/contact.js'),
  };

  // Define the HTML files you want to create
  const htmlPages = [
    { template: 'pages/index.html', filename: 'index.html', entry: 'index' },
  //  { template: 'pages/about.html', filename: 'about.html', entry: 'about' },
    //{ template: 'pages/contact.html', filename: 'contact.html', entry: 'contact' },
  ];

  return {
    entry: entries, // Use the entry points defined above
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].[contenthash].js', // Dynamically use the entry point name in the output
      clean: true,
    },
    devtool: isProd ? false : 'source-map',
    module: {
      rules: [
        {
          test: /\.css$/i,
          use: [
            isProd ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
            'postcss-loader',
          ],
        },
        {
          test: /\.html$/i,
          loader: 'html-loader',
        },
      ],
    },
    resolve: {
      modules: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
      extensions: ['.js', '.json', '.wasm'],
    },
    plugins: [
      // Create HtmlWebpackPlugin instances dynamically for each HTML page
      ...htmlPages.map(page => new HtmlWebpackPlugin({
        template: path.resolve(__dirname, page.template),
        filename: page.filename,
        chunks: [page.entry], // Only include the JS bundle specific to this page
      })),
      new MiniCssExtractPlugin({
        filename: 'styles.[contenthash].css',
      }),
    ],
    mode: isProd ? 'production' : 'development',
  };
};
