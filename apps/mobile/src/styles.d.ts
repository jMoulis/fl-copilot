declare module "*.css";
declare module "*.png" {
  const asset: import("react-native").ImageSourcePropType;
  export default asset;
}
declare module "*.webp" {
  const asset: import("react-native").ImageSourcePropType;
  export default asset;
}
