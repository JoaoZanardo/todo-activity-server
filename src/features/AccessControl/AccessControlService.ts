/* eslint-disable unused-imports/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-vars */
import to from 'await-to-js'

import { IFindModelByIdProps } from '../../core/interfaces/Model'
import { IAggregatePaginate } from '../../core/interfaces/Repository'
import { AccessControlModel, AccessControlType, IAccessControl, ICreateAccessControlByEquipmentIpProps, IListAccessControlsFilters, IValidateAccessControlCreationProps } from '../../models/AccessControl/AccessControlModel'
import { AccessControlRepositoryImp } from '../../models/AccessControl/AccessControlMongoDB'
import { AccessReleaseStatus } from '../../models/AccessRelease/AccessReleaseModel'
import EquipmentServer from '../../services/EquipmentServer'
import CustomResponse from '../../utils/CustomResponse'
import { AccessPointServiceImp } from '../AccessPoint/AccessPointController'
import { AccessReleaseServiceImp } from '../AccessRelease/AccessReleaseController'
import { EquipmentServiceImp } from '../Equipment/EquipmentController'
import { PersonServiceImp } from '../Person/PersonController'

export class AccessControlService {
  constructor (
    private accessControlRepositoryImp: typeof AccessControlRepositoryImp
  ) {
    this.accessControlRepositoryImp = accessControlRepositoryImp
  }

  async list (filters: IListAccessControlsFilters): Promise<IAggregatePaginate<IAccessControl>> {
    return await this.accessControlRepositoryImp.list(filters)
  }

  async findById ({
    id,
    tenantId
  }: IFindModelByIdProps): Promise<AccessControlModel> {
    const accessControl = await this.accessControlRepositoryImp.findById({
      id,
      tenantId
    })
    if (!accessControl) throw CustomResponse.NOT_FOUND('Controle de acesso não cadastrado!')

    return accessControl
  }

  async createByEquipmentIp ({
    equipmentIp,
    personId,
    tenantId
  }: ICreateAccessControlByEquipmentIpProps): Promise<AccessControlModel> {
    const equipment = await EquipmentServiceImp.findByIp({
      ip: equipmentIp,
      tenantId
    })

    const accessPoint = await AccessPointServiceImp.findByEquipmentId({
      equipmentId: equipment._id!,
      tenantId
    })

    const person = await PersonServiceImp.findById({
      id: personId,
      tenantId
    })

    const lastAccessRelease = await AccessReleaseServiceImp.findLastByPersonId({
      personId,
      tenantId
    })

    await this.validateAccessControlCreation({
      accessPoint,
      accessRelease: lastAccessRelease,
      tenantId
    })

    const accessControlModel = new AccessControlModel({
      accessPointId: accessPoint._id!,
      personId,
      personTypeId: person.personTypeId,
      tenantId,
      type: AccessControlType.entry, // mocked one
      accessReleaseId: lastAccessRelease!._id!,
      picture: lastAccessRelease!.object.picture
    })

    return await this.accessControlRepositoryImp.create(accessControlModel)
  }

  async create (accessControl: AccessControlModel): Promise<AccessControlModel> {
    const { tenantId, accessPointId, personId } = accessControl

    const accessPoint = await AccessPointServiceImp.findById({
      id: accessPointId,
      tenantId
    })

    const lastAccessRelease = await AccessReleaseServiceImp.findLastByPersonId({
      personId,
      tenantId
    })

    await this.validateAccessControlCreation({
      accessPoint,
      accessRelease: lastAccessRelease,
      tenantId
    })

    return await this.accessControlRepositoryImp.create(accessControl)
  }

  private async validateAccessControlCreation ({
    accessRelease,
    accessPoint,
    tenantId
  }: IValidateAccessControlCreationProps) {
    if (
      !accessRelease ||
      accessRelease.status !== AccessReleaseStatus.active
    ) throw CustomResponse.CONFLICT('Essa pessoa não possui uma liberação de acesso!')

    if (accessRelease.accessPointId.equals(accessPoint._id!)) {
      const person = await PersonServiceImp.findById({
        id: accessRelease.personId,
        tenantId
      })

      Promise.all(
        accessPoint.object.equipmentsIds.map(async equipmentId => {
          const equipment = await EquipmentServiceImp.findById({
            id: equipmentId,
            tenantId
          })

          const [error, _] = await to(
            EquipmentServer.removeAccess({
              equipmentIp: equipment.ip,
              personId: person._id!
            })
          )
        })
      )
    }

    if (accessPoint.object.generalExit && accessRelease.object.singleAccess) {
      await Promise.all([
        AccessReleaseServiceImp.disable({
          id: accessRelease._id!,
          tenantId,
          status: AccessReleaseStatus.disabled
        })
      ])
    }
  }
}
