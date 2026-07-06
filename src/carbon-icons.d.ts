// @carbon/icons는 타입 미제공 — deep ES import(@carbon/icons/es/<name>/<size>)를 any 디스크립터로 선언.
declare module '@carbon/icons/es/*' {
  const icon: any;
  export default icon;
}
