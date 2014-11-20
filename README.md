# Capybara::Ember::Inspector

Adds Ember Inspector capable Selenium Driver into your Capybara tests for convenient debugging

## Installation

Add this line to your application's Gemfile:

```ruby
group :test do
  gem 'capybara-ember-inspector', require: false
end
```

And then execute:

    $ bundle

Or install it yourself as:

    $ gem install capybara-ember-inspector

## Usage

Require `capybara/ember/inspector` in your test file, for example in `rails_helper.rb` or `spec_helper.rb` to set up Capybara's `:selenium` Driver to run your tests in Chrome with the Ember Inspector extension already enabled. This allows you to pause your tests at any time and activeate the inspector within Chrome, just like you would during development.

## Licensing

This gem contains a pre-built version of the [Ember Inspector](https://github.com/emberjs/ember-inspector) source code that is licensed under the [MIT License](https://github.com/emberjs/ember-inspector/blob/master/LICENSE) and is subject to copyrights.

## Contributing

1. Fork it ( https://github.com/[my-github-username]/capybara-ember-inspector/fork )
2. Create your feature branch (`git checkout -b my-new-feature`)
3. Commit your changes (`git commit -am 'Add some feature'`)
4. Push to the branch (`git push origin my-new-feature`)
5. Create a new Pull Request
