# How to run locally

- If you've installed `nvm` (recommended) you can simply ensure that the javascript runtime for Astro is used by running the following command: `nvm use`. If you have not yet installed the correct version of the javascript runtime, you'll be told to install it with `nvm install <version>` after which you'll be able to run the `use` command again.
- You can now install all required javascript dependencies by running `npm install`.
- Now you can run the website on your local machine by executing `npm run dev`. This will output an address like http://localhost:4321 where you can preview the website. You can now make changes to the website by editing files in the `src/` directory, and your browser will automatically refresh the page upon saving your changes to these files.

# How to deploy changes to the website

- You can propose changes to the website by submitting a Pull Request to this repository.
- Once your changes are accepted and merged into the `master` branch of this repository, the website will automatically be updated within minutes.
