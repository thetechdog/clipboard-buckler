# Clipboard Buckler
## Why?
While sites cannot view the contents of your clipboard without allowing them to do so at the browser level, they can replace the contents of your clipboard without any sort of permission required. This can be a problem, especially for non-technically savvy people, as this has been used in social engineering attacks such as pastejacking.

Even if you wouldn't fall for something like that, perhaps you do not like the idea of sites just tampering with your clipboard contents without your knowledge or consent.

## Functionality
Clipboard Buckler intercepts any attempts initiated by the site to copy something to your clipboard, and then prompts you for your consent. You can choose to allow or deny the copy request just once, or  you can tell Clipboard Buckler to always allow or never allow any future requests from the same site (which results in the site being added to the whitelist or the blacklist). The extension is disabled on whitelisted sites.

The UI allows you to manage the filter lists, with the options to add new sites to them (either by manually typing the domain or by adding the site opened in the active tab) or remove existing ones. You can also backup your lists by exporting them to a CSV file, or restore them by importing a previously exported CSV backup.

Lockdown Mode provides a set and forget experience by disabling prompting entirely and automatically blocking the copy APIs on any site that is not in the whitelist. This could be especially useful if you want to set up the extension for someone that is susceptible to clipboard hijacking attacks.

## Where to get it
Chrome: soon  
Firefox: soon

## License
(C) Andrei Ionel 2026, licensed under the MIT License

## AI Disclosure
AI was used in the development process of this extension
