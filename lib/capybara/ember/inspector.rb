require "capybara/ember/inspector/version"

Capybara.register_driver :selenium do |app|
  extension = File.expand_path('../inspector/extension', __FILE__)

  Capybara::Selenium::Driver.new(app,
    browser: :chrome,
    switches: [
      "--load-extension=#{extension}"
    ]
  )
end
