const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    entry: {
      index: './js/main.js',
      playground: './js/playground.js',
    },

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

    plugins: [
      // ✅ Copy Font Awesome separately
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

      // ✅ HTML pages
      new HtmlWebpackPlugin({
        template: './pages/index.html',
        filename: 'index.html',
        chunks: ['index'],
      }),

      new HtmlWebpackPlugin({
        template: './pages/playground.html',
        filename: 'playground.html',
        chunks: ['playground'],
      }),

      // ✅ Extract Tailwind CSS
      new MiniCssExtractPlugin({
        filename: 'styles.[contenthash].css',
      }),
    ],

    resolve: {
      extensions: ['.js', '.json'],
    },

    mode: isProd ? 'production' : 'development',
  };
};
