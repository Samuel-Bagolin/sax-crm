from fastapi import HTTPException


def patch_data(model, required=()):
    data = model.model_dump(exclude_unset=True)
    if any(key in data and data[key] is None for key in required):
        raise HTTPException(422, "Campo obrigatório não pode ser nulo")
    return data
