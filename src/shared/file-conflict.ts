export class FileConflictError extends Error {
    readonly code='FILE_CONFLICT'
}

export function isFileConflict(error:unknown):boolean {
    return typeof error==='object'&&error!==null&&'code' in error&&error.code==='FILE_CONFLICT'
}


export class FileMissingError extends Error {
    readonly code='FILE_NOT_FOUND'
}
export function isFileMissing(error:unknown):boolean {
    return typeof error==='object'&&error!==null&&'code' in error&&error.code==='FILE_NOT_FOUND'
}
