export const WINDOWS_DRIVE_PATH=/^[A-Za-z]:[\\/]/;
export const isNetworkPath=(path:string)=>/^[\\/]{2}/.test(path);
export const isAbsoluteLocalPath=(path:string)=>!isNetworkPath(path)&&(WINDOWS_DRIVE_PATH.test(path)||path.startsWith('/'));
