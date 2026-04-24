const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');

const purgecss = require('@fullhuman/postcss-purgecss');

const tailwindPipeline = [
  'style-loader',
  'css-loader',
  {
    loader: 'postcss-loader',
    options: {
      postcssOptions: {
        plugins: [
          require('tailwindcss'),
          require('autoprefixer'),
          // No PurgeCSS here — Tailwind handles its own purging via tailwind.config.js
        ],
      },
    },
  },
];

const fontAwesomePipeline = [
  'style-loader',
  'css-loader',
  {
    loader: 'postcss-loader',
    options: {
      postcssOptions: {
        plugins: [
          purgecss({
            content: ['./pages/**/*.html', './js/**/*.js'],
            defaultExtractor: content => content.match(/[\w-/:]+(?<!:)/g) || [],
            safelist: [/^fa/, /^svg-inline--fa/],
          }),
        ],
      },
    },
  },
];

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  // Swap style-loader for MiniCssExtractPlugin.loader in production
  const prodLoader = MiniCssExtractPlugin.loader;
  if (isProd) {
    tailwindPipeline[0] = prodLoader;
    fontAwesomePipeline[0] = prodLoader;
  }

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
        // Tailwind CSS — no PurgeCSS
        {
          test: /\.css$/i,
          exclude: /fontawesome/,
          use: tailwindPipeline,
        },
        // Font Awesome CSS — PurgeCSS applied
        {
          test: /\.css$/i,
          include: /fontawesome/,
          use: fontAwesomePipeline,
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/i,
          type: 'asset/resource',
          generator: { filename: 'webfonts/[name][ext][query]' },
        },
        {
          test: /\.html$/i,
          loader: 'html-loader',
          options: { minimize: { decodeEntities: false } },
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
            from: path.resolve(__dirname, 'node_modules/@fortawesome/fontawesome-free/webfonts'),
            to: path.resolve(__dirname, 'dist/webfonts'),
          },
        ],
      }),
      ...htmlPages.map(page => new HtmlWebpackPlugin({
        template: path.resolve(__dirname, page.template),
        filename: page.filename,
        chunks: [page.entry],
      })),
      new MiniCssExtractPlugin({ filename: '[name].[contenthash].css' }),
    ],
    mode: isProd ? 'production' : 'development',
  };
};
