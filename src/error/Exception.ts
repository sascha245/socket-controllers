export class Exception {
    public message: string;
    public name: string;

    constructor(message?: string) {
        this.message = message;
        this.name = new.target.name;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
