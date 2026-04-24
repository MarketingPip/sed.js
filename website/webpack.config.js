const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  const entries = {
    index: path.resolve(__dirname, 'js/main.js'),
    playground: path.resolve(__dirname, 'js/playground.js'),
  };

  const htmlPages = [
    { template: 'pages/index.html', filename: 'index.html', entry: 'index' },
    { template: 'pages/playground.html', filename: 'playground.html', entry: 'playground' },
  ];

  return {
    entry: entries,
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].[contenthash].js',
      clean: true,
      publicPath: '',
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
      ],
    },
    resolve: {
      modules: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
      extensions: ['.js', '.json', '.wasm', '.woff'],
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          {
            from: 'node_modules/@fortawesome/fontawesome-free/css/all.min.css',
            to: 'css/font-awesome.css',
          },
          {
            from: 'node_modules/@fortawesome/fontawesome-free/webfonts',
            to: 'webfonts',
          },
        ],
      }),

      ...htmlPages.map(page => new HtmlWebpackPlugin({
        template: path.resolve(__dirname, page.template),
        filename: page.filename,
        chunks: [page.entry],
      })),

      new MiniCssExtractPlugin({
        filename: 'styles.[contenthash].css',
      }),
    ],
    mode: isProd ? 'production' : 'development',
  };
};
