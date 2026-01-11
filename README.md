trax "v2"

standard habbo trax with some custom attributes, per-lane volume controls, low-pass "muffle filter", and saving entire tracks as .wav files

## note

the custom attibutes will not work with standard trax implementations, so theyre disabled by default, to enable them add a config url param to the link example:
?config=download;lowpass;volume

https://laynester.github.io/trax-v2/

https://remy-trax.netlify.app/

^ both of these are embedable, using an iframe inside nitro (via habbopages or custom implementation)

an example of how to get saved messages from the iframe, when pressing save button it posts a message to the parent window 'save-song', sends the trax string, do with the song string what u wish

```js
const onMessage = (event) => {
  const { data } = event;
  const { type = "", string = "" } = data;
  if (type == "save-song") {
    setSongData(string);
  }
};
window.addEventListener("message", onMessage);
```

same goes for preloading an existing song with its trax string, u can send the iframe a message like this:

```js
iframe.postMessage({
  type: "load-trax-string",
  string: "1:0,4;455,18",
});
```
