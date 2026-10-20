import { Image } from "react-native";

/** Keep this lazy native bridge separate from runtime-neutral capture logic.
 * A dynamic import of react-native itself enumerates legacy native getters. */
export function readNativeImageSize(uri: string) {
  return Image.getSize(uri);
}
