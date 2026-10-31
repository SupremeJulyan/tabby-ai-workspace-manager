import { Pipe, PipeTransform } from '@angular/core'
import { t } from './i18n'

@Pipe({name:'arwTranslate',pure:false})
export class ArwTranslatePipe implements PipeTransform {
    transform (value:string):string { return t(value) }
}
